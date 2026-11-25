import { createSign, generateKeyPairSync } from "node:crypto";

import { describe, it, expect, vi, beforeEach } from "vitest";

import { Webhook } from "../webhook.js";

import type { WebhookConfig } from "../webhook.js";
import type * as PancakeTs from "@waffo/pancake-ts";

type WebhookDispute = PancakeTs.WebhookDispute;
type DisputeEvent = PancakeTs.WebhookEvent<PancakeTs.WebhookDisputeEventData>;

// Mock verifyWebhook from pancake-ts
vi.mock("@waffo/pancake-ts", () => ({
  verifyWebhook: vi.fn(),
}));

// eslint-disable-next-line import/order -- must import after vi.mock() for mock to take effect
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
    const response = await handler(createRequest("{}") as never);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Invalid webhook signature");
  });

  it("should return 200 on valid webhook with no handlers", async () => {
    mockVerify.mockReturnValue({ eventType: "order.completed", data: {} } as never);

    const handler = Webhook({});
    const response = await handler(createRequest("{}") as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.received).toBe(true);
  });

  it("should call onPayload for every event", async () => {
    const event = { eventType: "order.completed", data: { orderId: "ORD_xxx" } };
    mockVerify.mockReturnValue(event as never);

    const onPayload = vi.fn();
    const handler = Webhook({ onPayload });
    await handler(createRequest("{}") as never);

    expect(onPayload).toHaveBeenCalledWith(event);
  });

  it("should dispatch to event-specific handler", async () => {
    const event = { eventType: "order.completed", data: { orderId: "ORD_xxx" } };
    mockVerify.mockReturnValue(event as never);

    const onOrderCompleted = vi.fn();
    const handler = Webhook({ onOrderCompleted });
    await handler(createRequest("{}") as never);

    expect(onOrderCompleted).toHaveBeenCalledWith(event);
  });

  it("should call both onPayload and event-specific handler", async () => {
    const event = { eventType: "subscription.activated", data: {} };
    mockVerify.mockReturnValue(event as never);

    const onPayload = vi.fn();
    const onSubscriptionActivated = vi.fn();
    const handler = Webhook({ onPayload, onSubscriptionActivated });
    await handler(createRequest("{}") as never);

    expect(onPayload).toHaveBeenCalledWith(event);
    expect(onSubscriptionActivated).toHaveBeenCalledWith(event);
  });

  it("should handle all event types", async () => {
    const eventTypes: Array<[string, keyof WebhookConfig]> = [
      ["order.completed", "onOrderCompleted"],
      ["subscription.activated", "onSubscriptionActivated"],
      ["subscription.payment_succeeded", "onSubscriptionPaymentSucceeded"],
      ["subscription.renewed", "onSubscriptionRenewed"],
      ["subscription.recovered", "onSubscriptionRecovered"],
      ["subscription.plan_changed", "onSubscriptionPlanChanged"],
      ["subscription.plan_change_scheduled", "onSubscriptionPlanChangeScheduled"],
      ["subscription.plan_change_failed", "onSubscriptionPlanChangeFailed"],
      ["subscription.canceling", "onSubscriptionCanceling"],
      ["subscription.uncanceled", "onSubscriptionUncanceled"],
      ["subscription.canceled", "onSubscriptionCanceled"],
      ["subscription.past_due", "onSubscriptionPastDue"],
      ["refund.succeeded", "onRefundSucceeded"],
      ["refund.failed", "onRefundFailed"],
      ["chargeback.filed", "onChargebackFiled"],
      ["chargeback.updated", "onChargebackUpdated"],
      ["store.domain_changed", "onStoreDomainChanged"],
      ["checkout.completed", "onCheckoutCompleted"],
      ["checkout.expired", "onCheckoutExpired"],
      ["store.domain_unbound", "onStoreDomainUnbound"],
      ["dispute.created", "onDisputeCreated"],
      ["dispute.updated", "onDisputeUpdated"],
      ["dispute.message_received", "onDisputeMessageReceived"],
    ];

    const actual = await vi.importActual<typeof PancakeTs>("@waffo/pancake-ts");
    expect(eventTypes.map(([eventType]) => eventType)).toEqual(Object.values(actual.WebhookEventType));

    for (const [eventType, handlerKey] of eventTypes) {
      vi.clearAllMocks();
      const event = { eventType, data: {} };
      mockVerify.mockReturnValue(event as never);

      const handlerFn = vi.fn();
      const config = { [handlerKey]: handlerFn } as WebhookConfig;
      const handler = Webhook(config);
      await handler(createRequest("{}") as never);

      expect(handlerFn).toHaveBeenCalledWith(event);
    }
  });

  it("should not call handler for unregistered event type", async () => {
    const event = { eventType: "subscription.canceled", data: {} };
    mockVerify.mockReturnValue(event as never);

    const onOrderCompleted = vi.fn();
    const handler = Webhook({ onOrderCompleted });
    await handler(createRequest("{}") as never);

    expect(onOrderCompleted).not.toHaveBeenCalled();
  });

  it("should return 500 when handler throws", async () => {
    const event = { eventType: "order.completed", data: {} };
    mockVerify.mockReturnValue(event as never);

    const onOrderCompleted = vi.fn().mockRejectedValue(new Error("DB error"));
    const handler = Webhook({ onOrderCompleted });
    const response = await handler(createRequest("{}") as never);

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
    const response = await handler(createRequest("{}") as never);

    expect(response.status).toBe(200);
    expect(order).toEqual(["onPayload", "onOrderCompleted"]);
  });

  describe("dispute events with real signature verification", () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    function signedRequest(body: object): Request {
      const payload = JSON.stringify(body);
      const ts = Date.now().toString();
      const signer = createSign("RSA-SHA256");
      signer.update(`${ts}.${payload}`);
      return createRequest(payload, `t=${ts},v1=${signer.sign(privateKey, "base64")}`);
    }

    const dispute: WebhookDispute = {
      disputeId: "DSP_7n2KqLs",
      source: "wechat",
      status: "in_progress",
      escalated: false,
      category: null,
      reason: "Item not received",
      description: "I paid but never got access.",
      respondBy: "2026-11-28T08:00:00.000Z",
      paymentId: "PAY_5xK9mRt",
      orderId: "ORD_3hBfDe",
      buyerEmail: "buyer@example.com",
      amount: "19.99",
      currency: "CNY",
      pspDisputeId: "200000020251125000001",
    };

    const cases: Array<[string, "onDisputeCreated" | "onDisputeUpdated" | "onDisputeMessageReceived", WebhookDispute]> = [
      ["dispute.created", "onDisputeCreated", dispute],
      ["dispute.updated", "onDisputeUpdated", { ...dispute, previousStatus: "open" }],
      [
        "dispute.message_received",
        "onDisputeMessageReceived",
        {
          ...dispute,
          message: {
            messageId: "DMSG_9pQr",
            authorType: "buyer",
            body: "Any update?",
            attachmentCount: 1,
            createdAt: "2026-11-25T09:00:00.000Z",
          },
        },
      ],
    ];

    it.each(cases)("should verify %s and pass a typed data.dispute to %s", async (eventType, handlerKey, expected) => {
      const actual = await vi.importActual<typeof PancakeTs>("@waffo/pancake-ts");
      mockVerify.mockImplementation(actual.verifyWebhook);

      let received: DisputeEvent | undefined;
      const handlerFn = vi.fn((event: DisputeEvent) => {
        received = event;
      });
      const handler = Webhook({ verifyOptions: { publicKey: publicKey as string }, [handlerKey]: handlerFn });
      const response = await handler(
        signedRequest({
          id: dispute.disputeId,
          eventType,
          eventId: "DSP_7n2KqLs-1",
          storeId: "STO_1",
          storeName: "S",
          mode: "test",
          data: { dispute: expected },
        }) as never,
      );

      expect(response.status).toBe(200);
      expect(handlerFn).toHaveBeenCalledTimes(1);
      expect(received?.eventType).toBe(eventType);
      expect(received?.data.dispute).toEqual(expected);
      expect(received?.data.dispute.disputeId).toBe("DSP_7n2KqLs");
    });

    it("should reject a dispute event with a tampered body", async () => {
      const actual = await vi.importActual<typeof PancakeTs>("@waffo/pancake-ts");
      mockVerify.mockImplementation(actual.verifyWebhook);

      const original = signedRequest({ eventType: "dispute.created", data: { dispute } });
      const tampered = createRequest(
        JSON.stringify({ eventType: "dispute.created", data: { dispute: { ...dispute, amount: "0.01" } } }),
        original.headers.get("x-waffo-signature"),
      );
      const onDisputeCreated = vi.fn();
      const response = await Webhook({ verifyOptions: { publicKey: publicKey as string }, onDisputeCreated })(tampered as never);

      expect(response.status).toBe(401);
      expect(onDisputeCreated).not.toHaveBeenCalled();
    });
  });
});
