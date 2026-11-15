import { verifyWebhook } from "@waffo/pancake-ts";

import type { VerifyWebhookOptions, WebhookEvent, WebhookEventData } from "@waffo/pancake-ts";

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
  /**
   * Checkout session completed: the one-time order was paid, or the subscription was activated.
   *
   * Sent only for sessions on the one-page checkout, once per session; `event.eventId` is the
   * checkout session ID (`cs_…`) that create-session returned. Fires in addition to
   * `onOrderCompleted` / `onSubscriptionActivated`, not instead of them. A session the buyer
   * moved back to the legacy checkout sends neither checkout event.
   */
  onCheckoutCompleted?: EventHandler;
  /**
   * Checkout session expired without completing.
   *
   * Sent only for sessions on the one-page checkout, once per session; `event.eventId` is the
   * checkout session ID (`cs_…`). The session may never have had an order, in which case
   * `event.data.orderId` is `null` and `event.data.buyerEmail` may be `null`.
   */
  onCheckoutExpired?: EventHandler;
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
  "checkout.completed": "onCheckoutCompleted",
  "checkout.expired": "onCheckoutExpired",
};
/* eslint-enable @typescript-eslint/naming-convention */

/**
 * Create a Next.js POST route handler for Waffo Pancake webhooks.
 *
 * Automatically verifies the webhook signature using `@waffo/pancake-ts`,
 * then dispatches to the matching event handler.
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
