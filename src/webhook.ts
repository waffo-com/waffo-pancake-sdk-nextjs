import { verifyWebhook } from "@waffo/pancake-ts";

import type {
  VerifyWebhookOptions,
  WebhookCheckoutSessionData,
  WebhookDisputeEventData,
  WebhookEvent,
  WebhookEventData,
  WebhookStoreDomainChangedData,
  WebhookStoreDomainUnboundData,
} from "@waffo/pancake-ts";

/** Handler function for a specific webhook event */
type EventHandler<T = WebhookEventData> = (event: WebhookEvent<T>) => void | Promise<void>;

/** Configuration for the Webhook route handler factory */
export interface WebhookConfig {
  /** Webhook signature verification options (environment, publicKey, tolerance, etc.) */
  verifyOptions?: VerifyWebhookOptions;

  /** Catch-all handler — called for every event regardless of type */
  onPayload?: EventHandler;

  /** One-time order first payment succeeded */
  onOrderCompleted?: EventHandler;
  /** Subscription first payment succeeded (newly activated) */
  onSubscriptionActivated?: EventHandler;
  /** Subscription payment succeeded — a pure payment event, carries no subscription period or status */
  onSubscriptionPaymentSucceeded?: EventHandler;
  /** Current billing period rolled forward (renewal) */
  onSubscriptionRenewed?: EventHandler;
  /** Subscription recovered from past due (a retried charge succeeded) */
  onSubscriptionRecovered?: EventHandler;
  /** Plan change took effect (upgrade/downgrade) */
  onSubscriptionPlanChanged?: EventHandler;
  /** Plan change confirmed, takes effect next billing period */
  onSubscriptionPlanChangeScheduled?: EventHandler;
  /** Plan change did not complete, the current plan stays in effect */
  onSubscriptionPlanChangeFailed?: EventHandler;
  /** Customer initiated cancellation (expires at end of current period) */
  onSubscriptionCanceling?: EventHandler;
  /** Customer withdrew cancellation (subscription restored) */
  onSubscriptionUncanceled?: EventHandler;
  /** Subscription fully terminated */
  onSubscriptionCanceled?: EventHandler;
  /** Renewal payment failed (past due) */
  onSubscriptionPastDue?: EventHandler;
  /** Refund succeeded */
  onRefundSucceeded?: EventHandler;
  /** Refund failed */
  onRefundFailed?: EventHandler;
  /** New chargeback case filed against a payment, including a second-cycle case; `event.data.chargeback` describes it */
  onChargebackFiled?: EventHandler;
  /** Chargeback status changed; `event.data.chargeback.previousStatus` is the status before the change */
  onChargebackUpdated?: EventHandler;
  /** Store's verified domain replaced after review */
  onStoreDomainChanged?: EventHandler<WebhookStoreDomainChangedData>;
  /** Checkout session completed (one-time order paid or subscription activated) */
  onCheckoutCompleted?: EventHandler<WebhookCheckoutSessionData>;
  /** Checkout session expired without a successful payment */
  onCheckoutExpired?: EventHandler<WebhookCheckoutSessionData>;
  /** Store's domain unbound by the store owner or by Waffo */
  onStoreDomainUnbound?: EventHandler<WebhookStoreDomainUnboundData>;
  /** Customer complaint became visible to the merchant; `event.data.dispute` describes it */
  onDisputeCreated?: EventHandler<WebhookDisputeEventData>;
  /** Complaint status changed; `event.data.dispute.previousStatus` is the status before the change */
  onDisputeUpdated?: EventHandler<WebhookDisputeEventData>;
  /** Complaint received a new message from the customer or the payment channel; `event.data.dispute.message` is that message */
  onDisputeMessageReceived?: EventHandler<WebhookDisputeEventData>;
}

/* eslint-disable @typescript-eslint/naming-convention -- event type keys use dot notation */
const EVENT_HANDLER_MAP: Record<string, keyof WebhookConfig> = {
  "order.completed": "onOrderCompleted",
  "subscription.activated": "onSubscriptionActivated",
  "subscription.payment_succeeded": "onSubscriptionPaymentSucceeded",
  "subscription.renewed": "onSubscriptionRenewed",
  "subscription.recovered": "onSubscriptionRecovered",
  "subscription.plan_changed": "onSubscriptionPlanChanged",
  "subscription.plan_change_scheduled": "onSubscriptionPlanChangeScheduled",
  "subscription.plan_change_failed": "onSubscriptionPlanChangeFailed",
  "subscription.canceling": "onSubscriptionCanceling",
  "subscription.uncanceled": "onSubscriptionUncanceled",
  "subscription.canceled": "onSubscriptionCanceled",
  "subscription.past_due": "onSubscriptionPastDue",
  "refund.succeeded": "onRefundSucceeded",
  "refund.failed": "onRefundFailed",
  "chargeback.filed": "onChargebackFiled",
  "chargeback.updated": "onChargebackUpdated",
  "store.domain_changed": "onStoreDomainChanged",
  "checkout.completed": "onCheckoutCompleted",
  "checkout.expired": "onCheckoutExpired",
  "store.domain_unbound": "onStoreDomainUnbound",
  "dispute.created": "onDisputeCreated",
  "dispute.updated": "onDisputeUpdated",
  "dispute.message_received": "onDisputeMessageReceived",
};
/* eslint-enable @typescript-eslint/naming-convention */

/**
 * Create a Next.js POST route handler for Waffo Pancake webhooks.
 *
 * Automatically verifies the webhook signature using `@waffo/pancake-ts`,
 * then dispatches to the matching event handler.
 *
 * A delivery can arrive more than once (retries), so make handlers idempotent on
 * `event.eventType` + `event.eventId`. Don't key on `event.id` alone: it is the entity
 * ID, and every `dispute.*` event of one complaint carries the same `id` (`DSP_xxx`),
 * so deduplicating on it would drop that complaint's later updates and messages.
 *
 * @param config - Verification options and event handlers
 * @returns A Next.js POST route handler
 *
 * @example
 * ```ts
 * // app/api/webhooks/waffo/route.ts
 * import { Webhook } from "@waffo/pancake-nextjs";
 *
 * export const POST = Webhook({
 *   verifyOptions: { environment: "prod" },
 *   onOrderCompleted: async (event) => {
 *     console.log("Order completed:", event.data.orderId);
 *     // Grant access to the product
 *   },
 *   onSubscriptionActivated: async (event) => {
 *     console.log("Subscription activated:", event.data.orderId);
 *   },
 *   onRefundSucceeded: async (event) => {
 *     console.log("Refund succeeded:", event.data.refundId);
 *     // Revoke access
 *   },
 *   onDisputeCreated: async (event) => {
 *     const { dispute } = event.data;
 *     console.log("Complaint", dispute.disputeId, "respond by", dispute.respondBy);
 *   },
 * });
 * ```
 */
export function Webhook(config: WebhookConfig) {
  return async function POST(request: Request): Promise<Response> {
    const payload = await request.text();
    const signature = request.headers.get("x-waffo-signature");

    let event: WebhookEvent;
    try {
      event = verifyWebhook(payload, signature, config.verifyOptions);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Webhook verification failed";
      return new Response(JSON.stringify({ error: message }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      // Catch-all handler
      if (config.onPayload) {
        await config.onPayload(event);
      }

      // Event-specific handler
      const handlerKey = EVENT_HANDLER_MAP[event.eventType];
      if (handlerKey) {
        const handler = config[handlerKey] as EventHandler | undefined;
        if (handler) {
          await handler(event);
        }
      }

      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Webhook handler error";
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  };
}
