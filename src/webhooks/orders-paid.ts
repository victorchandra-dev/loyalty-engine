import {buildCustomerLoyaltyState} from '../domain/customer-state.js';
import type {LoyaltyProgramConfig} from '../domain/program.js';

export type OrdersPaidWebhookPayload = {
  id?: number | null;
  admin_graphql_api_id?: string | null;
  admin_graphql_api_customer_id?: string | null;
  current_total_price?: string | null;
  customer?: {
    id?: number | null;
  } | null;
};

export function getOrdersPaidOrderGid(
  payload: OrdersPaidWebhookPayload,
): string | null {
  if (payload.admin_graphql_api_id) return payload.admin_graphql_api_id;
  if (payload.id) return `gid://shopify/Order/${payload.id}`;
  return null;
}

export type OrdersPaidSyncPlan = {
  customerAdminId: string;
  loyaltyStateValue: string;
};

export function getOrdersPaidCustomerAdminId(
  payload: OrdersPaidWebhookPayload,
) {
  if (payload.admin_graphql_api_customer_id) {
    return payload.admin_graphql_api_customer_id;
  }

  if (payload.customer?.id) {
    return `gid://shopify/Customer/${payload.customer.id}`;
  }

  return null;
}

export function buildOrdersPaidSyncPlan({
  currencyCode,
  customerAdminId,
  lifetimeSpend,
  numberOfOrders,
  pointsBalance = 0,
  awardedRules,
  lastOrderId,
  program,
}: {
  currencyCode: string;
  customerAdminId: string;
  lifetimeSpend: number;
  numberOfOrders: number;
  pointsBalance?: number;
  awardedRules?: string[];
  lastOrderId?: string;
  program: LoyaltyProgramConfig;
}): OrdersPaidSyncPlan {
  const loyaltyState = buildCustomerLoyaltyState({
    metrics: {
      lifetimeSpend,
      paidOrderCount: numberOfOrders,
      pointsBalance,
      currencyCode,
    },
    awardedRules,
    lastOrderId,
    program,
  });

  return {
    customerAdminId,
    loyaltyStateValue: JSON.stringify(loyaltyState),
  };
}

export function getOrdersPaidOrderAmount(payload: OrdersPaidWebhookPayload) {
  const raw = payload.current_total_price;
  if (!raw) return 0;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
