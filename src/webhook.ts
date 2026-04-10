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
  /** Subscription renewal payment succeeded */
  onSubscriptionPaymentSucceeded?: EventHandler;
  /** Buyer initiated cancellation (expires at end of current period) */
  onSubscriptionCanceling?: EventHandler;
  /** Buyer withdrew cancellation (subscription restored) */
  onSubscriptionUncanceled?: EventHandler;
  /** Subscription product changed (upgrade/downgrade) */
  onSubscriptionUpdated?: EventHandler;
  /** Subscription fully terminated */
  onSubscriptionCanceled?: EventHandler;
  /** Renewal payment failed (past due) */
  onSubscriptionPastDue?: EventHandler;
  /** Refund succeeded */
  onRefundSucceeded?: EventHandler;
  /** Refund failed */
  onRefundFailed?: EventHandler;
}

/* eslint-disable @typescript-eslint/naming-convention -- event type keys use dot notation */
const EVENT_HANDLER_MAP: Record<string, keyof WebhookConfig> = {
  "order.completed": "onOrderCompleted",
  "subscription.activated": "onSubscriptionActivated",
  "subscription.payment_succeeded": "onSubscriptionPaymentSucceeded",
  "subscription.canceling": "onSubscriptionCanceling",
  "subscription.uncanceled": "onSubscriptionUncanceled",
  "subscription.updated": "onSubscriptionUpdated",
  "subscription.canceled": "onSubscriptionCanceled",
  "subscription.past_due": "onSubscriptionPastDue",
  "refund.succeeded": "onRefundSucceeded",
  "refund.failed": "onRefundFailed",
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
