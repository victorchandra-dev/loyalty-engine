import type {AdminApiContext} from '@shopify/shopify-app-react-router/server';
import {
  CUSTOMER_SPEND_QUERY,
  METAFIELDS_SET_MUTATION,
  METAFIELD_DEFINITION_BY_KEY_QUERY,
  METAFIELD_DEFINITION_CREATE_MUTATION,
  METAFIELD_DEFINITION_UPDATE_MUTATION,
} from '../../src/integrations/shopify/admin-operations.js';
import {buildOrdersPaidSyncPlan} from '../../src/webhooks/orders-paid.js';
import {
  computeOrderPoints,
  getOneShotEarnPoints,
} from '../../src/domain/program.js';
import type {LoyaltyProgramConfig} from '../../src/domain/program.js';
import {
  APP_METAFIELD_NAMESPACE,
  CUSTOMER_LOYALTY_ACTIVE_REDEMPTION_KEY,
  CUSTOMER_LOYALTY_POINTS_BALANCE_KEY,
  CUSTOMER_LOYALTY_STATE_KEY,
  REDEMPTION_TTL_MS,
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
  awardedRules,
}: {
  admin: AdminApiContext;
  customerAdminId: string;
  program: LoyaltyProgramConfig;
  pointsBalance?: number;
  awardedRules?: string[];
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
    awardedRules,
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
  awardedRules,
}: {
  admin: AdminApiContext;
  customerAdminId: string;
  currencyCode: string;
  lifetimeSpend: number;
  numberOfOrders: number;
  program: LoyaltyProgramConfig;
  pointsBalance?: number;
  awardedRules?: string[];
}) {
  const plan = buildOrdersPaidSyncPlan({
    currencyCode,
    customerAdminId,
    lifetimeSpend,
    numberOfOrders,
    pointsBalance,
    awardedRules,
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

// ----------------------------------------------------------------------------
// Points awarding
// ----------------------------------------------------------------------------

const CUSTOMER_POINTS_BALANCE_QUERY = `#graphql
  query LoyaltyCustomerPointsBalance($id: ID!) {
    customer(id: $id) {
      id
      pointsBalance: metafield(namespace: "$app", key: "loyalty_points_balance") {
        value
      }
      stateValue: metafield(namespace: "$app", key: "loyalty_state") {
        value
      }
    }
  }
` as const;

type CustomerPointsBalanceData = {
  customer: {
    id: string;
    pointsBalance: {value: string | null} | null;
    stateValue: {value: string | null} | null;
  } | null;
};

export async function fetchCustomerPointsState(
  admin: AdminApiContext,
  customerAdminId: string,
): Promise<{
  pointsBalance: number;
  signupAwarded: boolean;
}> {
  const data = await adminGraphql<CustomerPointsBalanceData>(
    admin,
    CUSTOMER_POINTS_BALANCE_QUERY,
    {id: customerAdminId},
  );

  const balance = Number.parseInt(
    data.customer?.pointsBalance?.value ?? '0',
    10,
  );

  // Inspect the loyalty_state JSON for an awardedRules tracker so we don't
  // double-award one-shot rules. Older state records won't have this field;
  // they default to "not yet awarded".
  let signupAwarded = false;
  const stateRaw = data.customer?.stateValue?.value;
  if (stateRaw) {
    try {
      const parsed = JSON.parse(stateRaw) as {awardedRules?: string[]};
      signupAwarded = Boolean(parsed.awardedRules?.includes('signup'));
    } catch {
      // ignore parse errors — treat as not yet awarded
    }
  }

  return {
    pointsBalance: Number.isFinite(balance) ? balance : 0,
    signupAwarded,
  };
}

/**
 * Compute the new points balance for a paid order.
 *
 * Adds:
 *  - Points for the `order` earn rule (1pt/$1 by default, or pointsValue)
 *  - Signup bonus (one-shot) if program has a signup rule and the customer
 *    has not yet been credited it.
 *
 * Pure function — no IO. Returns the new balance + which rules were just
 * awarded for the first time so caller can persist the awardedRules list.
 */
export function projectPointsAwardForOrder({
  orderAmount,
  currentBalance,
  signupAwarded,
  program,
}: {
  orderAmount: number;
  currentBalance: number;
  signupAwarded: boolean;
  program: LoyaltyProgramConfig;
}): {
  newBalance: number;
  pointsAwarded: number;
  newlyAwardedOneShots: string[];
} {
  const orderPoints = computeOrderPoints({
    orderAmount,
    earnRules: program.earnRules,
  });

  let oneShotPoints = 0;
  const newlyAwardedOneShots: string[] = [];

  if (!signupAwarded) {
    const signupBonus = getOneShotEarnPoints('signup', program.earnRules);
    if (signupBonus > 0) {
      oneShotPoints += signupBonus;
      newlyAwardedOneShots.push('signup');
    }
  }

  const totalAwarded = orderPoints + oneShotPoints;
  return {
    newBalance: Math.max(0, currentBalance + totalAwarded),
    pointsAwarded: totalAwarded,
    newlyAwardedOneShots,
  };
}

// ----------------------------------------------------------------------------
// Redemption application
// ----------------------------------------------------------------------------

/**
 * The JSON shape the discount function reads from the customer's
 * loyalty_active_redemption metafield. The function only honours fixed_discount
 * and percent_discount; other reward types can be persisted but are filtered
 * out at function-evaluation time.
 */
export type ActiveRedemptionRecord = {
  handle: string;
  rewardType: string;
  rewardValue?: string | null;
  pointsCost: number;
  expiresAt: string;
  redemptionId?: string | null;
  redeemedAt: string;
};

export class RedemptionError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
    this.name = 'RedemptionError';
  }
}

/**
 * Apply a redemption for a customer:
 *  - Read the program snapshot to find the redemption by handle.
 *  - Read the customer's current points balance.
 *  - Verify balance >= pointsCost; otherwise throw 400.
 *  - Debit the balance and persist both the new balance and the active
 *    redemption record (with a default TTL).
 *
 * Returns the new balance and the redemption record written.
 */
export async function applyRedemptionForCustomer({
  admin,
  customerAdminId,
  redemptionHandle,
  program,
}: {
  admin: AdminApiContext;
  customerAdminId: string;
  redemptionHandle: string;
  program: LoyaltyProgramConfig;
}): Promise<{
  newBalance: number;
  redemption: ActiveRedemptionRecord;
}> {
  const redemption = program.redemptions.find(
    (entry) => entry.handle === redemptionHandle && entry.active,
  );
  if (!redemption) {
    throw new RedemptionError(
      `No active redemption with handle "${redemptionHandle}" exists in the program.`,
      404,
    );
  }

  const currentState = await fetchCustomerPointsState(admin, customerAdminId);
  if (currentState.pointsBalance < redemption.pointsCost) {
    throw new RedemptionError(
      `Customer has ${currentState.pointsBalance} points but the redemption requires ${redemption.pointsCost}.`,
      400,
    );
  }

  const now = new Date();
  const record: ActiveRedemptionRecord = {
    handle: redemption.handle,
    rewardType: redemption.rewardType,
    rewardValue: redemption.rewardValue ?? null,
    pointsCost: redemption.pointsCost,
    expiresAt: new Date(now.getTime() + REDEMPTION_TTL_MS).toISOString(),
    redemptionId: redemption.id,
    redeemedAt: now.toISOString(),
  };

  const newBalance = Math.max(0, currentState.pointsBalance - redemption.pointsCost);

  const result = await adminGraphql<MetafieldsSetMutationData>(
    admin,
    METAFIELDS_SET_MUTATION,
    {
      metafields: [
        {
          ownerId: customerAdminId,
          namespace: APP_METAFIELD_NAMESPACE,
          key: CUSTOMER_LOYALTY_POINTS_BALANCE_KEY,
          type: 'number_integer',
          value: String(newBalance),
        },
        {
          ownerId: customerAdminId,
          namespace: APP_METAFIELD_NAMESPACE,
          key: CUSTOMER_LOYALTY_ACTIVE_REDEMPTION_KEY,
          type: 'json',
          value: JSON.stringify(record),
        },
      ],
    },
  );

  assertNoUserErrors(
    result.metafieldsSet.userErrors,
    'Failed to apply customer redemption',
  );

  return {newBalance, redemption: record};
}

/**
 * Clear an active redemption (e.g. after the discount is applied at checkout
 * or if the customer cancels). Optionally refund the points so a redeem-then-
 * abandon flow doesn't burn the balance — pass `refund: true` for that.
 */
export async function clearRedemptionForCustomer({
  admin,
  customerAdminId,
  refund = false,
}: {
  admin: AdminApiContext;
  customerAdminId: string;
  refund?: boolean;
}) {
  let pointsBalance: number | null = null;

  if (refund) {
    const currentState = await fetchCustomerPointsState(admin, customerAdminId);
    const refundedAmount = await fetchActiveRedemptionPointsCost(
      admin,
      customerAdminId,
    );
    pointsBalance = currentState.pointsBalance + refundedAmount;
  }

  const metafields: Array<Record<string, unknown>> = [
    {
      ownerId: customerAdminId,
      namespace: APP_METAFIELD_NAMESPACE,
      key: CUSTOMER_LOYALTY_ACTIVE_REDEMPTION_KEY,
      type: 'json',
      value: JSON.stringify(null),
    },
  ];

  if (pointsBalance !== null) {
    metafields.push({
      ownerId: customerAdminId,
      namespace: APP_METAFIELD_NAMESPACE,
      key: CUSTOMER_LOYALTY_POINTS_BALANCE_KEY,
      type: 'number_integer',
      value: String(pointsBalance),
    });
  }

  const result = await adminGraphql<MetafieldsSetMutationData>(
    admin,
    METAFIELDS_SET_MUTATION,
    {metafields},
  );

  assertNoUserErrors(
    result.metafieldsSet.userErrors,
    'Failed to clear customer redemption',
  );

  return {pointsBalance};
}

const ACTIVE_REDEMPTION_QUERY = `#graphql
  query LoyaltyCustomerActiveRedemption($id: ID!) {
    customer(id: $id) {
      id
      activeRedemption: metafield(
        namespace: "$app"
        key: "loyalty_active_redemption"
      ) {
        value
      }
    }
  }
` as const;

type ActiveRedemptionQueryData = {
  customer: {
    id: string;
    activeRedemption: {value: string | null} | null;
  } | null;
};

async function fetchActiveRedemptionPointsCost(
  admin: AdminApiContext,
  customerAdminId: string,
): Promise<number> {
  const data = await adminGraphql<ActiveRedemptionQueryData>(
    admin,
    ACTIVE_REDEMPTION_QUERY,
    {id: customerAdminId},
  );
  const raw = data.customer?.activeRedemption?.value;
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw) as {pointsCost?: number};
    return typeof parsed.pointsCost === 'number' && Number.isFinite(parsed.pointsCost)
      ? parsed.pointsCost
      : 0;
  } catch {
    return 0;
  }
}
