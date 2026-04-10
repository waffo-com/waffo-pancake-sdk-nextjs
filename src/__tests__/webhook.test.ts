import { describe, it, expect, vi, beforeEach } from "vitest";

import { Webhook } from "../webhook.js";

import type { WebhookConfig } from "../webhook.js";

// Mock verifyWebhook from pancake-ts
vi.mock("@waffo/pancake-ts", () => ({
  verifyWebhook: vi.fn(),
}));

import { verifyWebhook } from "@waffo/pancake-ts";

const mockVerify = vi.mocked(verifyWebhook);

function createRequest(body: string, signature: string | null = "t=123,v1=abc"): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (signature !== null) {
    headers.set("x-waffo-signature", signature);
  }
  return new Request("http://localhost/api/webhooks/waffo", {
    method: "POST",
    headers,
    body,
  });
}

describe("Webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 401 when verification fails", async () => {
    mockVerify.mockImplementation(() => {
      throw new Error("Invalid webhook signature");
    });

    const handler = Webhook({});
    const response = await handler(createRequest('{}') as never);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Invalid webhook signature");
  });

  it("should return 200 on valid webhook with no handlers", async () => {
    mockVerify.mockReturnValue({ eventType: "order.completed", data: {} } as never);

    const handler = Webhook({});
    const response = await handler(createRequest('{}') as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.received).toBe(true);
  });

  it("should call onPayload for every event", async () => {
    const event = { eventType: "order.completed", data: { orderId: "ORD_xxx" } };
    mockVerify.mockReturnValue(event as never);

    const onPayload = vi.fn();
    const handler = Webhook({ onPayload });
    await handler(createRequest('{}') as never);

    expect(onPayload).toHaveBeenCalledWith(event);
  });

  it("should dispatch to event-specific handler", async () => {
    const event = { eventType: "order.completed", data: { orderId: "ORD_xxx" } };
    mockVerify.mockReturnValue(event as never);

    const onOrderCompleted = vi.fn();
    const handler = Webhook({ onOrderCompleted });
    await handler(createRequest('{}') as never);

    expect(onOrderCompleted).toHaveBeenCalledWith(event);
  });

  it("should call both onPayload and event-specific handler", async () => {
    const event = { eventType: "subscription.activated", data: {} };
    mockVerify.mockReturnValue(event as never);

    const onPayload = vi.fn();
    const onSubscriptionActivated = vi.fn();
    const handler = Webhook({ onPayload, onSubscriptionActivated });
    await handler(createRequest('{}') as never);

    expect(onPayload).toHaveBeenCalledWith(event);
    expect(onSubscriptionActivated).toHaveBeenCalledWith(event);
  });

  it("should handle all event types", async () => {
    const eventTypes: Array<[string, keyof WebhookConfig]> = [
      ["order.completed", "onOrderCompleted"],
      ["subscription.activated", "onSubscriptionActivated"],
      ["subscription.payment_succeeded", "onSubscriptionPaymentSucceeded"],
      ["subscription.canceling", "onSubscriptionCanceling"],
      ["subscription.uncanceled", "onSubscriptionUncanceled"],
      ["subscription.updated", "onSubscriptionUpdated"],
      ["subscription.canceled", "onSubscriptionCanceled"],
      ["subscription.past_due", "onSubscriptionPastDue"],
      ["refund.succeeded", "onRefundSucceeded"],
      ["refund.failed", "onRefundFailed"],
    ];

    for (const [eventType, handlerKey] of eventTypes) {
      vi.clearAllMocks();
      const event = { eventType, data: {} };
      mockVerify.mockReturnValue(event as never);

      const handlerFn = vi.fn();
      const config = { [handlerKey]: handlerFn } as WebhookConfig;
      const handler = Webhook(config);
      await handler(createRequest('{}') as never);

      expect(handlerFn).toHaveBeenCalledWith(event);
    }
  });

  it("should not call handler for unregistered event type", async () => {
    const event = { eventType: "subscription.canceled", data: {} };
    mockVerify.mockReturnValue(event as never);

    const onOrderCompleted = vi.fn();
    const handler = Webhook({ onOrderCompleted });
    await handler(createRequest('{}') as never);

    expect(onOrderCompleted).not.toHaveBeenCalled();
  });

  it("should return 500 when handler throws", async () => {
    const event = { eventType: "order.completed", data: {} };
    mockVerify.mockReturnValue(event as never);

    const onOrderCompleted = vi.fn().mockRejectedValue(new Error("DB error"));
    const handler = Webhook({ onOrderCompleted });
    const response = await handler(createRequest('{}') as never);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("DB error");
  });

  it("should pass verifyOptions to verifyWebhook", async () => {
    mockVerify.mockReturnValue({ eventType: "order.completed", data: {} } as never);

    const verifyOptions = { environment: "prod" as const };
    const handler = Webhook({ verifyOptions });
    await handler(createRequest('{"test":true}') as never);

    expect(mockVerify).toHaveBeenCalledWith('{"test":true}', "t=123,v1=abc", verifyOptions);
  });

  it("should handle async handlers", async () => {
    const event = { eventType: "order.completed", data: {} };
    mockVerify.mockReturnValue(event as never);

    const order: string[] = [];
    const onPayload = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      order.push("onPayload");
    });
    const onOrderCompleted = vi.fn(async () => {
      order.push("onOrderCompleted");
    });

    const handler = Webhook({ onPayload, onOrderCompleted });
    const response = await handler(createRequest('{}') as never);

    expect(response.status).toBe(200);
    expect(order).toEqual(["onPayload", "onOrderCompleted"]);
  });
});
