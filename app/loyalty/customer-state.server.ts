import type {AdminApiContext} from '@shopify/shopify-app-react-router/server';
import {
  CUSTOMER_SPEND_QUERY,
  METAFIELDS_SET_MUTATION,
} from '../../src/integrations/shopify/admin-operations.js';
import {buildOrdersPaidSyncPlan} from '../../src/webhooks/orders-paid.js';
import type {LoyaltyProgramConfig} from '../../src/domain/program.js';
import {
  APP_METAFIELD_NAMESPACE,
  CUSTOMER_LOYALTY_POINTS_BALANCE_KEY,
  CUSTOMER_LOYALTY_STATE_KEY,
} from './constants';
import {adminGraphql, assertNoUserErrors} from './graphql.server';

type CustomerSpendQueryData = {
  customer: {
    id: string;
    amountSpent: {
      amount: string;
      currencyCode: string;
    } | null;
    numberOfOrders: number;
  } | null;
};

type MetafieldsSetMutationData = {
  metafieldsSet: {
    userErrors: Array<{
      field?: Array<string | number> | null;
      message: string;
    }>;
  };
};

export async function fetchCustomerSpendMetrics(
  admin: AdminApiContext,
  customerAdminId: string,
) {
  const data = await adminGraphql<CustomerSpendQueryData>(
    admin,
    CUSTOMER_SPEND_QUERY,
    {id: customerAdminId},
  );

  if (!data.customer) {
    return null;
  }

  const parsedLifetimeSpend = Number.parseFloat(
    data.customer.amountSpent?.amount ?? '0',
  );

  return {
    customerAdminId: data.customer.id,
    currencyCode: data.customer.amountSpent?.currencyCode ?? null,
    lifetimeSpend: Number.isFinite(parsedLifetimeSpend)
      ? parsedLifetimeSpend
      : 0,
    numberOfOrders: Number(data.customer.numberOfOrders ?? 0),
  };
}

export async function syncCustomerLoyaltyState({
  admin,
  customerAdminId,
  program,
  pointsBalance = 0,
}: {
  admin: AdminApiContext;
  customerAdminId: string;
  program: LoyaltyProgramConfig;
  pointsBalance?: number;
}) {
  const metrics = await fetchCustomerSpendMetrics(admin, customerAdminId);

  if (!metrics) {
    return null;
  }

  const plan = await syncCustomerLoyaltyStateFromMetrics({
    admin,
    customerAdminId: metrics.customerAdminId,
    currencyCode: metrics.currencyCode ?? program.currencyCode,
    lifetimeSpend: metrics.lifetimeSpend,
    numberOfOrders: metrics.numberOfOrders,
    pointsBalance,
    program,
  });

  return {
    metrics,
    plan,
  };
}

export async function syncCustomerLoyaltyStateFromMetrics({
  admin,
  customerAdminId,
  currencyCode,
  lifetimeSpend,
  numberOfOrders,
  program,
  pointsBalance = 0,
}: {
  admin: AdminApiContext;
  customerAdminId: string;
  currencyCode: string;
  lifetimeSpend: number;
  numberOfOrders: number;
  program: LoyaltyProgramConfig;
  pointsBalance?: number;
}) {
  const plan = buildOrdersPaidSyncPlan({
    currencyCode,
    customerAdminId,
    lifetimeSpend,
    numberOfOrders,
    pointsBalance,
    program,
  });

  const result = await adminGraphql<MetafieldsSetMutationData>(
    admin,
    METAFIELDS_SET_MUTATION,
    {
      metafields: [
        {
          ownerId: plan.customerAdminId,
          namespace: APP_METAFIELD_NAMESPACE,
          key: CUSTOMER_LOYALTY_STATE_KEY,
          type: 'json',
          value: plan.loyaltyStateValue,
        },
        {
          ownerId: plan.customerAdminId,
          namespace: APP_METAFIELD_NAMESPACE,
          key: CUSTOMER_LOYALTY_POINTS_BALANCE_KEY,
          type: 'number_integer',
          value: String(pointsBalance),
        },
      ],
    },
  );

  assertNoUserErrors(
    result.metafieldsSet.userErrors,
    'Failed to sync customer loyalty state',
  );

  return plan;
}
