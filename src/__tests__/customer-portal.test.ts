import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { createCustomerPortalRedirect } from "../server.js";

const createCustomerPortalLink = vi.fn();

vi.mock("@waffo/pancake-ts", () => ({
  WaffoPancake: class {
    auth = { createCustomerPortalLink };
  },
}));

const CONFIG = { merchantId: "MER_0000000000000000000000", privateKey: "pk" };
const STORE_ID = "STO_0000000000000000000000";
const PORTAL_URL = `https://pancake.waffo.ai/consumer/portal/store/${STORE_ID}#token=portal-jwt`;

function expectNoStoreNoReferrer(response: Response) {
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
}

describe("createCustomerPortalRedirect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createCustomerPortalLink.mockResolvedValue({ portalUrl: PORTAL_URL, expiresAt: "2026-04-02T10:15:00.000Z" });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should 302 to the portal URL for the customer the resolver returns", async () => {
    const resolveAuthenticatedCustomer = vi.fn().mockResolvedValue({ storeId: STORE_ID, buyerIdentity: "user-1" });
    const GET = createCustomerPortalRedirect(CONFIG, { resolveAuthenticatedCustomer });
    const request = new Request("https://merchant.example/account/portal");

    const response = await GET(request);

    expect(resolveAuthenticatedCustomer).toHaveBeenCalledWith(request);
    expect(createCustomerPortalLink).toHaveBeenCalledWith({ storeId: STORE_ID, buyerIdentity: "user-1" });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(PORTAL_URL);
    expectNoStoreNoReferrer(response);
  });

  it("should ignore identity supplied by the browser and forward only resolver fields", async () => {
    const GET = createCustomerPortalRedirect(CONFIG, {
      resolveAuthenticatedCustomer: () => ({ storeId: STORE_ID, buyerIdentity: "session-user", extra: "x" }) as never,
    });

    await GET(
      new Request(`https://merchant.example/account/portal?buyerIdentity=victim&storeId=STO_1111111111111111111111`, {
        headers: { "x-buyer-identity": "victim" },
      }),
    );

    expect(createCustomerPortalLink).toHaveBeenCalledTimes(1);
    expect(createCustomerPortalLink).toHaveBeenCalledWith({ storeId: STORE_ID, buyerIdentity: "session-user" });
  });

  it("should answer 401 without calling the API when nobody is signed in", async () => {
    const GET = createCustomerPortalRedirect(CONFIG, { resolveAuthenticatedCustomer: async () => null });

    const response = await GET(new Request("https://merchant.example/account/portal"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expectNoStoreNoReferrer(response);
    expect(createCustomerPortalLink).not.toHaveBeenCalled();
  });

  it("should redirect to a relative loginUrl resolved against the request", async () => {
    const GET = createCustomerPortalRedirect(CONFIG, {
      resolveAuthenticatedCustomer: async () => null,
      loginUrl: "/login?returnTo=/account/portal",
    });

    const response = await GET(new Request("https://merchant.example/account/portal"));

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://merchant.example/login?returnTo=/account/portal");
    expectNoStoreNoReferrer(response);
    expect(createCustomerPortalLink).not.toHaveBeenCalled();
  });

  it("should accept a loginUrl function", async () => {
    const GET = createCustomerPortalRedirect(CONFIG, {
      resolveAuthenticatedCustomer: async () => null,
      loginUrl: (request) => `https://auth.example/signin?from=${encodeURIComponent(new URL(request.url).pathname)}`,
    });

    const response = await GET(new Request("https://merchant.example/account/portal"));

    expect(response.headers.get("Location")).toBe("https://auth.example/signin?from=%2Faccount%2Fportal");
  });

  it("should answer a generic 502 when link creation fails, without echoing the error", async () => {
    createCustomerPortalLink.mockRejectedValueOnce(new Error("secret upstream detail"));
    const GET = createCustomerPortalRedirect(CONFIG, {
      resolveAuthenticatedCustomer: async () => ({ storeId: STORE_ID, buyerIdentity: "user-1" }),
    });

    const response = await GET(new Request("https://merchant.example/account/portal"));

    expect(response.status).toBe(502);
    const body = await response.text();
    expect(body).not.toContain("secret upstream detail");
    expect(JSON.parse(body)).toEqual({ error: "Failed to create customer portal link" });
    expectNoStoreNoReferrer(response);
  });

  it("should log one safe line server-side on the default error path", async () => {
    createCustomerPortalLink.mockRejectedValueOnce(new Error(`upstream failed for ${PORTAL_URL}\nsecond line`));
    const GET = createCustomerPortalRedirect(CONFIG, {
      resolveAuthenticatedCustomer: async () => ({ storeId: STORE_ID, buyerIdentity: "user-1" }),
    });

    await GET(new Request("https://merchant.example/account/portal"));

    expect(console.error).toHaveBeenCalledTimes(1);
    const args = vi.mocked(console.error).mock.calls[0];
    expect(args[0]).toBe("[waffo-pancake] createCustomerPortalRedirect failed:");
    expect(typeof args[1]).toBe("string");
    const logged = args.join(" ");
    expect(logged).not.toContain("portal-jwt");
    expect(logged).toContain("#token=[redacted]");
    expect(logged).not.toContain("\n");
  });

  it("should log a non-Error rejection as its string form", async () => {
    createCustomerPortalLink.mockRejectedValueOnce("network down");
    const GET = createCustomerPortalRedirect(CONFIG, {
      resolveAuthenticatedCustomer: async () => ({ storeId: STORE_ID, buyerIdentity: "user-1" }),
    });

    await GET(new Request("https://merchant.example/account/portal"));

    expect(console.error).toHaveBeenCalledWith("[waffo-pancake] createCustomerPortalRedirect failed:", "network down");
  });

  it("should delegate failures to onError when given", async () => {
    const failure = new Error("boom");
    createCustomerPortalLink.mockRejectedValueOnce(failure);
    const onError = vi.fn().mockReturnValue(new Response("custom", { status: 503 }));
    const GET = createCustomerPortalRedirect(CONFIG, {
      resolveAuthenticatedCustomer: async () => ({ storeId: STORE_ID, buyerIdentity: "user-1" }),
      onError,
    });
    const request = new Request("https://merchant.example/account/portal");

    const response = await GET(request);

    expect(onError).toHaveBeenCalledWith(failure, request);
    expect(response.status).toBe(503);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("should propagate errors thrown by the resolver", async () => {
    const GET = createCustomerPortalRedirect(CONFIG, {
      resolveAuthenticatedCustomer: async () => {
        throw new Error("session store down");
      },
    });

    await expect(GET(new Request("https://merchant.example/account/portal"))).rejects.toThrow("session store down");
    expect(createCustomerPortalLink).not.toHaveBeenCalled();
  });
});
