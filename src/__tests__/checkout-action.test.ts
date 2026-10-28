import { describe, it, expect, vi, beforeEach } from "vitest";

import { createCheckoutAction, createCustomerSessionAction } from "../server.js";

import type { CheckoutActionParams } from "../server.js";
import type { AnonymousCheckoutProps, AuthenticatedCheckoutProps } from "../types.js";

const anonymousCreate = vi.fn().mockResolvedValue({ sessionId: "cs_anon", checkoutUrl: "https://x/checkout/cs_anon", expiresAt: "z" });
const authenticatedCreate = vi
  .fn()
  .mockResolvedValue({ sessionId: "cs_auth", checkoutUrl: "https://x/checkout/cs_auth#token=jwt", expiresAt: "z" });
const createPlanChangeSession = vi
  .fn()
  .mockResolvedValue({ sessionId: "cs_chg", checkoutUrl: "https://x/store/s/change/cs_chg", expiresAt: "z" });
const authenticatedPlanChange = vi
  .fn()
  .mockResolvedValue({ sessionId: "cs_chg_auth", checkoutUrl: "https://x/store/s/change/cs_chg_auth#token=jwt", expiresAt: "z" });
const customerPlanChange = vi
  .fn()
  .mockResolvedValue({ sessionId: "cs_chg_self", checkoutUrl: "https://x/store/s/change/cs_chg_self", expiresAt: "z" });

vi.mock("@waffo/pancake-ts", () => ({
  WaffoPancake: class {
    checkout = {
      anonymous: { create: anonymousCreate },
      authenticated: { create: authenticatedCreate, createPlanChange: authenticatedPlanChange },
      createPlanChangeSession,
    };
    buyer = () => ({ createPlanChangeSession: customerPlanChange });
  },
}));

const CONFIG = { merchantId: "MER_0000000000000000000000", privateKey: "pk" };

describe("createCheckoutAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should route an omitted or anonymous type to anonymous checkout", async () => {
    const checkout = createCheckoutAction(CONFIG);

    await checkout({ productId: "PROD_xxx", currency: "USD" });

    expect(anonymousCreate).toHaveBeenCalledWith({ productId: "PROD_xxx", currency: "USD" }, undefined);
    expect(createPlanChangeSession).not.toHaveBeenCalled();
  });

  it("should route an authenticated type to authenticated checkout", async () => {
    const checkout = createCheckoutAction(CONFIG);

    await checkout({ type: "authenticated", productId: "PROD_xxx", currency: "USD", buyerIdentity: "user-1" });

    expect(authenticatedCreate).toHaveBeenCalledWith({ productId: "PROD_xxx", currency: "USD", buyerIdentity: "user-1" }, undefined);
  });

  it("should route a planChange type to the plan change session, keeping originOrderId", async () => {
    const checkout = createCheckoutAction(CONFIG);

    const result = await checkout({
      type: "planChange",
      originOrderId: "ORD_xxx",
      productId: "PROD_target",
      currency: "USD",
    });

    // `type` is stripped, the plan change fields are forwarded untouched
    expect(createPlanChangeSession).toHaveBeenCalledWith(
      {
        originOrderId: "ORD_xxx",
        productId: "PROD_target",
        currency: "USD",
      },
      undefined,
    );
    expect(result.checkoutUrl).toContain("/change/");
  });

  it("should route an authenticatedPlanChange type to the authenticated plan change", async () => {
    const checkout = createCheckoutAction(CONFIG);

    const result = await checkout({
      type: "authenticatedPlanChange",
      originOrderId: "ORD_xxx",
      productId: "PROD_target",
      currency: "USD",
      buyerIdentity: "user-1",
    });

    expect(authenticatedPlanChange).toHaveBeenCalledWith(
      {
        originOrderId: "ORD_xxx",
        productId: "PROD_target",
        currency: "USD",
        buyerIdentity: "user-1",
      },
      undefined,
    );
    expect(result.checkoutUrl).toContain("#token=");
    expect(anonymousCreate).not.toHaveBeenCalled();
  });
});

describe("createCustomerSessionAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should route createPlanChangeSession to the customer session", async () => {
    const customerAction = createCustomerSessionAction({ ...CONFIG, environment: "test" });

    const result = (await customerAction("customer.jwt", "createPlanChangeSession", {
      originOrderId: "ORD_0000000000000000000000",
      productId: "PROD_0000000000000000000000",
      currency: "USD",
    })) as { checkoutUrl: string };

    expect(customerPlanChange).toHaveBeenCalledWith(
      {
        originOrderId: "ORD_0000000000000000000000",
        productId: "PROD_0000000000000000000000",
        currency: "USD",
      },
      undefined,
    );
    // The customer path gets a confirmation URL with no token fragment — the
    // caller already holds the session token.
    expect(result.checkoutUrl).toContain("/change/");
    expect(result.checkoutUrl).not.toContain("#token=");
    // and never reaches the merchant-signed entry points
    expect(createPlanChangeSession).not.toHaveBeenCalled();
    expect(authenticatedPlanChange).not.toHaveBeenCalled();
  });

  it("should reject an unknown customer action type", async () => {
    const customerAction = createCustomerSessionAction({ ...CONFIG, environment: "test" });

    await expect(
      // @ts-expect-error — not a member of CustomerSessionActionType
      customerAction("customer.jwt", "changePlanWithDiscount", {}),
    ).rejects.toThrow(/Unknown customer action/);
  });
});

describe("discount params from the browser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** What a browser can send to the Server Action, bypassing the TypeScript types. */
  const fromBrowser = (params: Record<string, unknown>) => params as unknown as CheckoutActionParams;

  it("should strip couponId on anonymous and authenticated checkout", async () => {
    const checkout = createCheckoutAction(CONFIG);

    await checkout(fromBrowser({ productId: "PROD_xxx", currency: "USD", couponId: "CPN_xxx" }));
    await checkout(
      fromBrowser({ type: "authenticated", productId: "PROD_xxx", currency: "USD", buyerIdentity: "user-1", couponId: "CPN_xxx" }),
    );

    expect(anonymousCreate).toHaveBeenCalledWith({ productId: "PROD_xxx", currency: "USD" }, undefined);
    expect(authenticatedCreate).toHaveBeenCalledWith({ productId: "PROD_xxx", currency: "USD", buyerIdentity: "user-1" }, undefined);
  });

  it("should strip couponId on plan change flows too", async () => {
    const checkout = createCheckoutAction(CONFIG);
    const change = { originOrderId: "ORD_xxx", productId: "PROD_target", currency: "USD", couponId: "CPN_xxx" };

    await checkout(fromBrowser({ type: "planChange", ...change }));
    await checkout(fromBrowser({ type: "authenticatedPlanChange", buyerIdentity: "user-1", ...change }));

    expect(createPlanChangeSession).toHaveBeenCalledWith(
      { originOrderId: "ORD_xxx", productId: "PROD_target", currency: "USD" },
      undefined,
    );
    expect(authenticatedPlanChange).toHaveBeenCalledWith(
      { originOrderId: "ORD_xxx", productId: "PROD_target", currency: "USD", buyerIdentity: "user-1" },
      undefined,
    );
  });

  it("should forward allowPromotionCodes", async () => {
    const checkout = createCheckoutAction(CONFIG);

    await checkout(fromBrowser({ productId: "PROD_xxx", currency: "USD", allowPromotionCodes: true }));
    await checkout(
      fromBrowser({ type: "authenticated", productId: "PROD_xxx", currency: "USD", buyerIdentity: "user-1", allowPromotionCodes: true }),
    );

    expect(anonymousCreate).toHaveBeenCalledWith({ productId: "PROD_xxx", currency: "USD", allowPromotionCodes: true }, undefined);
    expect(authenticatedCreate).toHaveBeenCalledWith(
      { productId: "PROD_xxx", currency: "USD", buyerIdentity: "user-1", allowPromotionCodes: true },
      undefined,
    );
  });

  it("should strip promotionCode on anonymous and authenticated checkout", async () => {
    const checkout = createCheckoutAction(CONFIG);

    await checkout(fromBrowser({ productId: "PROD_xxx", currency: "USD", promotionCode: "SPRING-20", allowPromotionCodes: true }));
    await checkout(
      fromBrowser({ type: "authenticated", productId: "PROD_xxx", currency: "USD", buyerIdentity: "user-1", promotionCode: "SPRING-20" }),
    );

    // allowPromotionCodes still rides along — only the merchant-chosen code is dropped
    expect(anonymousCreate).toHaveBeenCalledWith({ productId: "PROD_xxx", currency: "USD", allowPromotionCodes: true }, undefined);
    expect(authenticatedCreate).toHaveBeenCalledWith({ productId: "PROD_xxx", currency: "USD", buyerIdentity: "user-1" }, undefined);
  });

  it("should strip promotionCode and couponId on plan change flows, forwarding allowPromotionCodes", async () => {
    const checkout = createCheckoutAction(CONFIG);
    const change = {
      originOrderId: "ORD_xxx",
      productId: "PROD_target",
      currency: "USD",
      couponId: "CPN_xxx",
      promotionCode: "SPRING-20",
      allowPromotionCodes: true,
    };

    await checkout(fromBrowser({ type: "planChange", ...change }));
    await checkout(fromBrowser({ type: "authenticatedPlanChange", buyerIdentity: "user-1", ...change }));

    expect(createPlanChangeSession).toHaveBeenCalledWith(
      { originOrderId: "ORD_xxx", productId: "PROD_target", currency: "USD", allowPromotionCodes: true },
      undefined,
    );
    expect(authenticatedPlanChange).toHaveBeenCalledWith(
      { originOrderId: "ORD_xxx", productId: "PROD_target", currency: "USD", buyerIdentity: "user-1", allowPromotionCodes: true },
      undefined,
    );
  });

  it("should keep couponId and promotionCode off CheckoutActionParams", () => {
    // @ts-expect-error — couponId is not part of the server action params
    const params: CheckoutActionParams = { productId: "PROD_xxx", currency: "USD", couponId: "CPN_xxx" };
    // @ts-expect-error — promotionCode is not part of the server action params
    const withCode: CheckoutActionParams = { productId: "PROD_xxx", currency: "USD", promotionCode: "SPRING-20" };
    const change: CheckoutActionParams = {
      type: "planChange",
      originOrderId: "ORD_xxx",
      productId: "PROD_target",
      currency: "USD",
      // @ts-expect-error — couponId is not part of the plan change server action params
      couponId: "CPN_xxx",
    };
    expect([params, withCode, change]).toHaveLength(3);
  });
});

describe("price and trial params from the browser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** What a browser can send to the Server Action, bypassing the TypeScript types. */
  const fromBrowser = (params: Record<string, unknown>) => params as unknown as CheckoutActionParams;

  /** Every merchant-only pricing field a browser could try to smuggle in. */
  const PRICING = {
    priceSnapshot: { amount: "0.01", taxCategory: "saas" },
    withTrial: true,
    changeAmount: "0.01",
    changeCreditAmount: "999.00",
  };

  it("should strip priceSnapshot, withTrial, changeAmount and changeCreditAmount on anonymous and authenticated checkout", async () => {
    const checkout = createCheckoutAction(CONFIG);

    await checkout(fromBrowser({ productId: "PROD_xxx", currency: "USD", ...PRICING }));
    await checkout(fromBrowser({ type: "authenticated", productId: "PROD_xxx", currency: "USD", buyerIdentity: "user-1", ...PRICING }));

    expect(anonymousCreate).toHaveBeenCalledWith({ productId: "PROD_xxx", currency: "USD" }, undefined);
    expect(authenticatedCreate).toHaveBeenCalledWith({ productId: "PROD_xxx", currency: "USD", buyerIdentity: "user-1" }, undefined);
  });

  it("should strip priceSnapshot, withTrial, changeAmount and changeCreditAmount on plan change flows", async () => {
    const checkout = createCheckoutAction(CONFIG);
    const change = { originOrderId: "ORD_xxx", productId: "PROD_target", currency: "USD", allowPromotionCodes: true, ...PRICING };

    await checkout(fromBrowser({ type: "planChange", ...change }));
    await checkout(fromBrowser({ type: "authenticatedPlanChange", buyerIdentity: "user-1", ...change }));

    expect(createPlanChangeSession).toHaveBeenCalledWith(
      { originOrderId: "ORD_xxx", productId: "PROD_target", currency: "USD", allowPromotionCodes: true },
      undefined,
    );
    expect(authenticatedPlanChange).toHaveBeenCalledWith(
      { originOrderId: "ORD_xxx", productId: "PROD_target", currency: "USD", buyerIdentity: "user-1", allowPromotionCodes: true },
      undefined,
    );
  });

  it("should not modify the params object it receives", async () => {
    const checkout = createCheckoutAction(CONFIG);
    const raw = { productId: "PROD_xxx", currency: "USD", ...PRICING };

    await checkout(fromBrowser(raw));

    expect(raw).toEqual({ productId: "PROD_xxx", currency: "USD", ...PRICING });
  });

  it("should keep the pricing fields off every CheckoutActionParams shape", () => {
    const anonymous: CheckoutActionParams = {
      productId: "PROD_xxx",
      currency: "USD",
      // @ts-expect-error — priceSnapshot is merchant-only
      priceSnapshot: { amount: "19.99", taxCategory: "digital_goods" },
    };
    const authenticated: CheckoutActionParams = {
      type: "authenticated",
      productId: "PROD_xxx",
      currency: "USD",
      buyerIdentity: "user-1",
      // @ts-expect-error — withTrial is merchant-only
      withTrial: false,
    };
    const planChange: CheckoutActionParams = {
      type: "planChange",
      originOrderId: "ORD_xxx",
      productId: "PROD_target",
      currency: "USD",
      // @ts-expect-error — changeCreditAmount is merchant-only
      changeCreditAmount: "8.00",
    };
    const authenticatedPlanChange: CheckoutActionParams = {
      type: "authenticatedPlanChange",
      originOrderId: "ORD_xxx",
      productId: "PROD_target",
      currency: "USD",
      buyerIdentity: "user-1",
      // @ts-expect-error — changeAmount is merchant-only
      changeAmount: "5.00",
    };
    const promotionOnPlanChange: CheckoutActionParams = {
      type: "authenticatedPlanChange",
      originOrderId: "ORD_xxx",
      productId: "PROD_target",
      currency: "USD",
      buyerIdentity: "user-1",
      // @ts-expect-error — promotionCode is merchant-only
      promotionCode: "SPRING-20",
    };
    expect([anonymous, authenticated, planChange, authenticatedPlanChange, promotionOnPlanChange]).toHaveLength(5);
  });

  it("should keep priceSnapshot and withTrial off the CheckoutButton props", () => {
    const action = createCheckoutAction(CONFIG);
    const anonymous: AnonymousCheckoutProps = {
      action,
      productId: "PROD_xxx",
      currency: "USD",
      // @ts-expect-error — priceSnapshot is merchant-only
      priceSnapshot: { amount: "19.99", taxCategory: "digital_goods" },
    };
    const authenticated: AuthenticatedCheckoutProps = {
      type: "authenticated",
      action,
      productId: "PROD_xxx",
      currency: "USD",
      buyerIdentity: "user-1",
      // @ts-expect-error — withTrial is merchant-only
      withTrial: true,
    };
    expect([anonymous, authenticated]).toHaveLength(2);
  });
});

describe("idempotency key pass-through", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards an explicit key to the checkout SDK call and sends none by default", async () => {
    const checkout = createCheckoutAction(CONFIG);

    await checkout({ productId: "PROD_xxx", currency: "USD" });
    await checkout({ productId: "PROD_xxx", currency: "USD" }, { idempotencyKey: "MER_checkout-2026-00891" });

    expect(anonymousCreate).toHaveBeenNthCalledWith(1, { productId: "PROD_xxx", currency: "USD" }, undefined);
    expect(anonymousCreate).toHaveBeenNthCalledWith(
      2,
      { productId: "PROD_xxx", currency: "USD" },
      { idempotencyKey: "MER_checkout-2026-00891" },
    );
  });

  it("forwards an explicit key through the customer session action", async () => {
    const customerAction = createCustomerSessionAction({ ...CONFIG, environment: "test" });

    await customerAction(
      "customer.jwt",
      "createPlanChangeSession",
      { originOrderId: "ORD_0000000000000000000000", productId: "PROD_0000000000000000000000", currency: "USD" },
      { idempotencyKey: "MER_self-service-2026-00893" },
    );

    expect(customerPlanChange).toHaveBeenCalledWith(expect.objectContaining({ originOrderId: "ORD_0000000000000000000000" }), {
      idempotencyKey: "MER_self-service-2026-00893",
    });
  });
});
