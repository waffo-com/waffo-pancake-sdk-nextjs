import { describe, it, expect, vi, beforeEach } from "vitest";

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
