import {buildCustomerLoyaltyState} from '../domain/customer-state.js';
import type {LoyaltyProgramConfig} from '../domain/program.js';

export type OrdersPaidWebhookPayload = {
  admin_graphql_api_customer_id?: string | null;
  current_total_price?: string | null;
  customer?: {
    id?: number | null;
  } | null;
};

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
  program,
}: {
  currencyCode: string;
  customerAdminId: string;
  lifetimeSpend: number;
  numberOfOrders: number;
  pointsBalance?: number;
  program: LoyaltyProgramConfig;
}): OrdersPaidSyncPlan {
  const loyaltyState = buildCustomerLoyaltyState({
    metrics: {
      lifetimeSpend,
      paidOrderCount: numberOfOrders,
      pointsBalance,
      currencyCode,
    },
    program,
  });

  return {
    customerAdminId,
    loyaltyStateValue: JSON.stringify(loyaltyState),
  };
}
