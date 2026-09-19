import { describe, it, expect, vi, beforeEach } from "vitest";

import { createCheckoutAction } from "../server.js";

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

vi.mock("@waffo/pancake-ts", () => ({
  WaffoPancake: class {
    checkout = {
      anonymous: { create: anonymousCreate },
      authenticated: { create: authenticatedCreate, createPlanChange: authenticatedPlanChange },
      createPlanChangeSession,
    };
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

    expect(anonymousCreate).toHaveBeenCalledWith({ productId: "PROD_xxx", currency: "USD" });
    expect(createPlanChangeSession).not.toHaveBeenCalled();
  });

  it("should route an authenticated type to authenticated checkout", async () => {
    const checkout = createCheckoutAction(CONFIG);

    await checkout({ type: "authenticated", productId: "PROD_xxx", currency: "USD", buyerIdentity: "user-1" });

    expect(authenticatedCreate).toHaveBeenCalledWith({ productId: "PROD_xxx", currency: "USD", buyerIdentity: "user-1" });
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
    expect(createPlanChangeSession).toHaveBeenCalledWith({
      originOrderId: "ORD_xxx",
      productId: "PROD_target",
      currency: "USD",
      changeCreditAmount: "8.00",
    });
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

    expect(authenticatedPlanChange).toHaveBeenCalledWith({
      originOrderId: "ORD_xxx",
      productId: "PROD_target",
      currency: "USD",
      buyerIdentity: "user-1",
    });
    expect(result.checkoutUrl).toContain("#token=");
    expect(anonymousCreate).not.toHaveBeenCalled();
  });
});
