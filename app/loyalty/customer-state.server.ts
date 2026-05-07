import type {AdminApiContext} from '@shopify/shopify-app-react-router/server';
import {
  CUSTOMER_SPEND_QUERY,
  METAFIELDS_SET_MUTATION,
  METAFIELD_DEFINITION_BY_KEY_QUERY,
  METAFIELD_DEFINITION_CREATE_MUTATION,
  METAFIELD_DEFINITION_UPDATE_MUTATION,
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

const LOYALTY_STATE_DEFINITION_NAME = 'Loyalty State';
const LOYALTY_STATE_DEFINITION_DESCRIPTION =
  'Derived loyalty state for the customer. Maintained by the loyalty engine.';
const CUSTOMER_ACCOUNT_READ = 'READ';

type MetafieldDefinitionByKeyData = {
  metafieldDefinitions: {
    nodes: Array<{
      id: string;
      namespace: string;
      key: string;
      access: {
        customerAccount: string | null;
      } | null;
    }>;
  };
};

type MetafieldDefinitionCreateData = {
  metafieldDefinitionCreate: {
    createdDefinition: {id: string; namespace: string; key: string} | null;
    userErrors: Array<{
      field?: Array<string | number> | null;
      message: string;
      code?: string | null;
    }>;
  };
};

type MetafieldDefinitionUpdateData = {
  metafieldDefinitionUpdate: {
    updatedDefinition: {id: string} | null;
    userErrors: Array<{
      field?: Array<string | number> | null;
      message: string;
      code?: string | null;
    }>;
  };
};

/**
 * Idempotently ensure the $app.loyalty_state Customer metafield definition
 * exists and grants Customer Account API READ access. Without this, the
 * storefront's Customer Account API cannot read the loyalty state.
 *
 * Strategy:
 *  - Query for an existing definition with namespace=$app key=loyalty_state
 *    on Customer.
 *  - If absent, create it with customerAccount: READ.
 *  - If present but access != READ, run a definition update.
 */
export async function ensureCustomerLoyaltyStateDefinition(
  admin: AdminApiContext,
) {
  const existing = await adminGraphql<MetafieldDefinitionByKeyData>(
    admin,
    METAFIELD_DEFINITION_BY_KEY_QUERY,
    {
      namespace: APP_METAFIELD_NAMESPACE,
      key: CUSTOMER_LOYALTY_STATE_KEY,
      ownerType: 'CUSTOMER',
    },
  );

  const definition = existing.metafieldDefinitions.nodes[0];

  if (!definition) {
    const created = await adminGraphql<MetafieldDefinitionCreateData>(
      admin,
      METAFIELD_DEFINITION_CREATE_MUTATION,
      {
        definition: {
          name: LOYALTY_STATE_DEFINITION_NAME,
          description: LOYALTY_STATE_DEFINITION_DESCRIPTION,
          namespace: APP_METAFIELD_NAMESPACE,
          key: CUSTOMER_LOYALTY_STATE_KEY,
          type: 'json',
          ownerType: 'CUSTOMER',
          access: {
            customerAccount: CUSTOMER_ACCOUNT_READ,
          },
        },
      },
    );

    assertNoUserErrors(
      created.metafieldDefinitionCreate.userErrors,
      'Failed to create loyalty_state metafield definition',
    );

    return created.metafieldDefinitionCreate.createdDefinition;
  }

  if (definition.access?.customerAccount !== CUSTOMER_ACCOUNT_READ) {
    const updated = await adminGraphql<MetafieldDefinitionUpdateData>(
      admin,
      METAFIELD_DEFINITION_UPDATE_MUTATION,
      {
        definition: {
          namespace: APP_METAFIELD_NAMESPACE,
          key: CUSTOMER_LOYALTY_STATE_KEY,
          ownerType: 'CUSTOMER',
          access: {
            customerAccount: CUSTOMER_ACCOUNT_READ,
          },
        },
      },
    );

    assertNoUserErrors(
      updated.metafieldDefinitionUpdate.userErrors,
      'Failed to update loyalty_state metafield definition access',
    );
  }

  return definition;
}
