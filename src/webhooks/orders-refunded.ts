import {computeOrderPoints} from '../domain/program.js';
import type {LoyaltyEarnRuleConfig} from '../domain/program.js';

export type OrdersRefundedWebhookPayload = {
  id?: number | null;
  admin_graphql_api_id?: string | null;
  admin_graphql_api_customer_id?: string | null;
  customer?: {id?: number | null} | null;
  refunds?: Array<{
    transactions?: Array<{
      amount?: string | null;
      kind?: string | null;
      status?: string | null;
    }> | null;
  }> | null;
};

export function getOrdersRefundedCustomerAdminId(
  payload: OrdersRefundedWebhookPayload,
): string | null {
  if (payload.admin_graphql_api_customer_id) {
    return payload.admin_graphql_api_customer_id;
  }
  if (payload.customer?.id) {
    return `gid://shopify/Customer/${payload.customer.id}`;
  }
  return null;
}

export function getOrdersRefundedOrderGid(
  payload: OrdersRefundedWebhookPayload,
): string | null {
  if (payload.admin_graphql_api_id) return payload.admin_graphql_api_id;
  if (payload.id) return `gid://shopify/Order/${payload.id}`;
  return null;
}

/**
 * Sum the monetary amount across all successful refund transactions in the
 * payload. Shopify may send multiple refund records (partial refunds), each
 * with multiple transactions.
 */
export function getOrdersRefundedAmount(
  payload: OrdersRefundedWebhookPayload,
): number {
  let total = 0;
  for (const refund of payload.refunds ?? []) {
    for (const tx of refund.transactions ?? []) {
      if (tx.kind === 'refund' && tx.status === 'success' && tx.amount) {
        const parsed = Number.parseFloat(tx.amount);
        if (Number.isFinite(parsed) && parsed > 0) {
          total += parsed;
        }
      }
    }
  }
  return total;
}

/**
 * Compute how many points to debit for a refunded order.
 * Mirrors `computeOrderPoints` — only `order` earn rules are reversed.
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
  return computeOrderPoints({orderAmount: refundedAmount, earnRules});
}
