import { describe, it, expect, vi, beforeEach } from "vitest";

import { createCheckoutAction, createCustomerSessionAction } from "../server.js";

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
      changeCreditAmount: "8.00",
    });

    // `type` is stripped, every plan change field is forwarded untouched
    expect(createPlanChangeSession).toHaveBeenCalledWith(
      {
        originOrderId: "ORD_xxx",
        productId: "PROD_target",
        currency: "USD",
        changeCreditAmount: "8.00",
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
