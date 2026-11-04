import {computeOrderPoints} from '../domain/program.js';
import type {LoyaltyEarnRuleConfig} from '../domain/program.js';

/**
 * The `refunds/create` payload is the refund itself: it has `order_id` and its
 * own top-level `transactions`, but no customer. The handler looks the
 * customer up from the order.
 */
export type OrdersRefundedWebhookPayload = {
  id?: number | null;
  order_id?: number | null;
  admin_graphql_api_id?: string | null;
  transactions?: Array<{
    amount?: string | null;
    kind?: string | null;
    status?: string | null;
  }> | null;
};

/** The refund's GID, used as the duplicate-delivery key. */
export function getRefundGid(
  payload: OrdersRefundedWebhookPayload,
): string | null {
  if (payload.admin_graphql_api_id) return payload.admin_graphql_api_id;
  if (payload.id) return `gid://shopify/Refund/${payload.id}`;
  return null;
}

export function getOrdersRefundedOrderGid(
  payload: OrdersRefundedWebhookPayload,
): string | null {
  return payload.order_id ? `gid://shopify/Order/${payload.order_id}` : null;
}

/** Sum of the successful refund transactions in this refund. */
export function getOrdersRefundedAmount(
  payload: OrdersRefundedWebhookPayload,
): number {
  let total = 0;
  for (const tx of payload.transactions ?? []) {
    if (tx.kind === 'refund' && tx.status === 'success' && tx.amount) {
      const parsed = Number.parseFloat(tx.amount);
      if (Number.isFinite(parsed) && parsed > 0) {
        total += parsed;
      }
    }
  }
  return total;
}

/**
 * Compute how many points to debit for a refunded order.
 * Mirrors `computeOrderPoints` — only `order` earn rules are reversed, and only
 * the per-currency-unit ones: a flat per-order amount would be taken again on
 * every partial refund (two $5 refunds on a 200-point order took 400).
 * One-shot bonuses (signup, referral) are intentionally not reversed because
 * they were awarded for the customer relationship, not the specific order.
 */
export function computeRefundPointsDebit({
  refundedAmount,
  earnRules,
}: {
  refundedAmount: number;
  earnRules: LoyaltyEarnRuleConfig[];
}): number {
  return computeOrderPoints({
    orderAmount: refundedAmount,
    earnRules: earnRules.filter((rule) => rule.pointsValue === null),
  });
}
