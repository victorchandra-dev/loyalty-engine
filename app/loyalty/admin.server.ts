import type {AdminApiContext} from '@shopify/shopify-app-react-router/server';
import {
  CUSTOMERS_PAGE_QUERY,
  DISCOUNT_AUTOMATIC_APP_CREATE_MUTATION,
  DISCOUNT_AUTOMATIC_APP_UPDATE_MUTATION,
  METAOBJECT_DEFINITION_CREATE_MUTATION,
  METAOBJECT_DEFINITION_UPDATE_MUTATION,
  METAOBJECT_DELETE_MUTATION,
  METAOBJECT_UPSERT_MUTATION,
  METAFIELDS_SET_MUTATION,
} from '../../src/integrations/shopify/admin-operations.js';
import {LOYALTY_METAOBJECT_TYPES} from '../../src/domain/program.js';
import type {MerchantMetaobjectEntry} from '../../src/domain/program.js';
import type {LoyaltyProgramConfiguration} from './program.server';
import {
  fetchLoyaltyProgramConfiguration,
  syncShopProgramSnapshot,
} from './program.server';
import {
  APP_METAFIELD_NAMESPACE,
  SHOP_LOYALTY_DISCOUNT_ID_KEY,
} from './constants';
import {adminGraphql, assertNoUserErrors} from './graphql.server';
import {
  loadLoyaltyCustomer,
  loadProgramSnapshot,
  saveLoyaltyCustomer,
} from './customer-state.server';
import {seedDefaultEarnRulesAndRedemptions} from './earn-rules-redemptions-admin.server';

const LOYALTY_DISCOUNT_TITLE = 'Loyalty Program Discount';
const LOYALTY_DISCOUNT_FUNCTION_HANDLE = 'loyalty-discount';
const CUSTOMER_SYNC_PAGE_SIZE = 50;

export type LoyaltyTierEditorEntry = {
  id: string | null;
  handle: string | null;
  label: string;
  minimumSpend: string;
  discountPercentage: string;
};

export type LoyaltyTierInput = {
  id?: string | null;
  handle?: string | null;
  label: string;
  minimumSpend: number;
  discountPercentage: number;
};

type MutationUserError = {
  field?: Array<string | number> | null;
  message: string;
  code?: string | null;
};

type MetaobjectMutationPayload = {
  userErrors: MutationUserError[];
};

type MetaobjectDefinitionMutationData = {
  metaobjectDefinitionCreate?: MetaobjectMutationPayload;
  metaobjectDefinitionUpdate?: MetaobjectMutationPayload;
};

type MetaobjectUpsertMutationData = {
  metaobjectUpsert: MetaobjectMutationPayload;
};

type MetaobjectDeleteMutationData = {
  metaobjectDelete: MetaobjectMutationPayload;
};

type MetafieldsSetMutationData = {
  metafieldsSet: {
    userErrors: MutationUserError[];
  };
};

type DiscountAutomaticMutationData = {
  discountAutomaticAppCreate?: {
    automaticAppDiscount: {
      discountId: string;
    } | null;
    userErrors: MutationUserError[];
  };
  discountAutomaticAppUpdate?: {
    automaticAppDiscount: {
      discountId: string;
    } | null;
    userErrors: MutationUserError[];
  };
};

type CustomersPageQueryData = {
  customers: {
    nodes: Array<{id: string}>;
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
  };
};

type DefinitionBlueprint = {
  type: string;
  name: string;
  description: string;
  displayNameKey: string;
  fieldDefinitions: Array<{
    key: string;
    name: string;
    type: string;
  }>;
};

const LOYALTY_DEFINITION_BLUEPRINTS: DefinitionBlueprint[] = [
  {
    type: LOYALTY_METAOBJECT_TYPES.tier,
    name: 'Loyalty Reward Tier',
    description:
      'Merchant-managed spend thresholds that define loyalty levels and inline discount rewards.',
    displayNameKey: 'label',
    fieldDefinitions: [
      {
        key: 'label',
        name: 'Label',
        type: 'single_line_text_field',
      },
      {
        key: 'minimum_spend',
        name: 'Minimum spend',
        type: 'number_decimal',
      },
      {
        key: 'discount_percentage',
        name: 'Discount percentage',
        type: 'number_decimal',
      },
    ],
  },
  {
    type: LOYALTY_METAOBJECT_TYPES.benefit,
    name: 'Loyalty Reward Benefit',
    description:
      'Optional explicit loyalty benefits that can extend tiers beyond discounts.',
    displayNameKey: 'label',
    fieldDefinitions: [
      {
        key: 'label',
        name: 'Label',
        type: 'single_line_text_field',
      },
      {
        key: 'tier_handle',
        name: 'Tier handle',
        type: 'single_line_text_field',
      },
      {
        key: 'benefit_type',
        name: 'Benefit type',
        type: 'single_line_text_field',
      },
      {
        key: 'benefit_value',
        name: 'Benefit value',
        type: 'number_decimal',
      },
      {
        key: 'display_label',
        name: 'Display label',
        type: 'single_line_text_field',
      },
      {
        key: 'description',
        name: 'Description',
        type: 'multi_line_text_field',
      },
      {
        key: 'active',
        name: 'Active',
        type: 'boolean',
      },
      {
        key: 'metadata_json',
        name: 'Metadata JSON',
        type: 'multi_line_text_field',
      },
    ],
  },
  {
    type: LOYALTY_METAOBJECT_TYPES.earnRule,
    name: 'Loyalty Earn Rule',
    description:
      'Loyalty earn rules. order/signup/referral award automatically; other actions are awarded manually from the Customers page.',
    displayNameKey: 'title',
    fieldDefinitions: [
      {
        key: 'title',
        name: 'Title',
        type: 'single_line_text_field',
      },
      {
        key: 'description',
        name: 'Description',
        type: 'multi_line_text_field',
      },
      {
        key: 'action',
        name: 'Action code',
        type: 'single_line_text_field',
      },
      {
        key: 'points_value',
        name: 'Points value',
        type: 'number_integer',
      },
      {
        key: 'active',
        name: 'Active',
        type: 'boolean',
      },
      {
        key: 'repeatable',
        name: 'Repeatable',
        type: 'boolean',
      },
    ],
  },
  {
    type: LOYALTY_METAOBJECT_TYPES.redemption,
    name: 'Loyalty Redemption',
    description:
      'Catalog of point redemptions (fixed or percent discount).',
    displayNameKey: 'title',
    fieldDefinitions: [
      {
        key: 'title',
        name: 'Title',
        type: 'single_line_text_field',
      },
      {
        key: 'description',
        name: 'Description',
        type: 'multi_line_text_field',
      },
      {
        key: 'reward_type',
        name: 'Reward type',
        type: 'single_line_text_field',
      },
      {
        key: 'reward_value',
        name: 'Reward value',
        type: 'single_line_text_field',
      },
      {
        key: 'points_cost',
        name: 'Points cost',
        type: 'number_integer',
      },
      {
        key: 'active',
        name: 'Active',
        type: 'boolean',
      },
    ],
  },
];

const DEFAULT_TIER_SEEDS: LoyaltyTierInput[] = [
  {
    handle: 'reward-5',
    label: '5% Reward',
    minimumSpend: 300,
    discountPercentage: 5,
  },
  {
    handle: 'reward-10',
    label: '10% Reward',
    minimumSpend: 700,
    discountPercentage: 10,
  },
  {
    handle: 'reward-15',
    label: '15% Reward',
    minimumSpend: 1500,
    discountPercentage: 15,
  },
];

export function buildTierEditorEntries(
  tierEntries: MerchantMetaobjectEntry[],
): LoyaltyTierEditorEntry[] {
  const rows = tierEntries.reduce<LoyaltyTierEditorEntry[]>((accumulator, entry) => {
      const label = entry.fields.label?.trim();
      const minimumSpend = entry.fields.minimum_spend?.trim();

      if (!label || !minimumSpend) {
        return accumulator;
      }

      accumulator.push({
        id: entry.id,
        handle: entry.handle,
        label,
        minimumSpend,
        discountPercentage: entry.fields.discount_percentage?.trim() || '0',
      });

      return accumulator;
    }, []);

  if (rows.length > 0) {
    return rows.sort(
      (left, right) =>
        Number.parseFloat(left.minimumSpend) - Number.parseFloat(right.minimumSpend),
    );
  }

  return DEFAULT_TIER_SEEDS.map((seed) => ({
    id: null,
    handle: seed.handle ?? null,
    label: seed.label,
    minimumSpend: String(seed.minimumSpend),
    discountPercentage: String(seed.discountPercentage),
  }));
}

export async function initializeLoyaltyProgram(admin: AdminApiContext) {
  const configuration = await ensureLoyaltyDefinitions(admin);

  if (configuration.tierEntries.length === 0) {
    await applyTierEntries(admin, configuration, DEFAULT_TIER_SEEDS);
  }

  await seedDefaultEarnRulesAndRedemptions({admin, configuration});

  return reconcileLoyaltyProgram(admin);
}

export async function saveTierConfiguration({
  admin,
  tiers,
}: {
  admin: AdminApiContext;
  tiers: LoyaltyTierInput[];
}) {
  const sanitizedTiers = sanitizeTierInputs(tiers);
  let configuration = await ensureLoyaltyDefinitions(admin);

  await applyTierEntries(admin, configuration, sanitizedTiers);

  configuration = await reconcileLoyaltyProgram(admin);

  return {
    configuration,
    tiers: buildTierEditorEntries(configuration.tierEntries),
  };
}

/**
 * Recompute every customer's tier state from their current spend. Points,
 * one-time awards and any waiting reward are written back exactly as read;
 * a customer that can't be read is skipped, never written with a guess.
 */
export async function backfillCustomerLoyaltyLevels(admin: AdminApiContext) {
  const {program} = await loadProgramSnapshot(admin);

  if (!program) {
    throw new Error(
      'The loyalty program is not resolved yet. Initialize the program before syncing customers.',
    );
  }

  let syncedCustomers = 0;
  let failedCustomers = 0;
  let cursor: string | null = null;

  do {
    const page: CustomersPageQueryData = await adminGraphql<CustomersPageQueryData>(
      admin,
      CUSTOMERS_PAGE_QUERY,
      {
        first: CUSTOMER_SYNC_PAGE_SIZE,
        ...(cursor ? {after: cursor} : {}),
      },
    );

    for (const {id} of page.customers.nodes) {
      try {
        const customer = await loadLoyaltyCustomer(admin, id);
        if (!customer) continue;
        await saveLoyaltyCustomer(admin, {program, customer, balance: customer.balance});
        syncedCustomers += 1;
      } catch (error) {
        failedCustomers += 1;
        console.error(`[loyalty] Skipped customer ${id} during sync`, error);
      }
    }

    cursor = page.customers.pageInfo.endCursor;

    if (!page.customers.pageInfo.hasNextPage) {
      break;
    }
  } while (cursor);

  return {
    syncedCustomers,
    failedCustomers,
    tierCount: program.tiers.length,
  };
}

export async function reconcileLoyaltyProgram(admin: AdminApiContext) {
  const configuration = await syncShopProgramSnapshot(admin);
  const discountId = await ensureAutomaticDiscount(admin, configuration);

  if (discountId && discountId !== configuration.currentDiscountId) {
    await persistDiscountId(admin, configuration.shopId, discountId);
  }

  return fetchLoyaltyProgramConfiguration(admin);
}

function lookupDefinition(
  configuration: LoyaltyProgramConfiguration,
  type: string,
) {
  switch (type) {
    case LOYALTY_METAOBJECT_TYPES.tier:
      return configuration.tierDefinition;
    case LOYALTY_METAOBJECT_TYPES.benefit:
      return configuration.benefitDefinition;
    case LOYALTY_METAOBJECT_TYPES.earnRule:
      return configuration.earnRuleDefinition;
    case LOYALTY_METAOBJECT_TYPES.redemption:
      return configuration.redemptionDefinition;
    default:
      return null;
  }
}

async function ensureLoyaltyDefinitions(admin: AdminApiContext) {
  let configuration = await fetchLoyaltyProgramConfiguration(admin);

  for (const blueprint of LOYALTY_DEFINITION_BLUEPRINTS) {
    const currentDefinition = lookupDefinition(configuration, blueprint.type);

    if (!currentDefinition) {
      await createMetaobjectDefinition(admin, blueprint);
      continue;
    }

    const missingFields = blueprint.fieldDefinitions.filter(
      (fieldDefinition) =>
        !currentDefinition.fieldDefinitions.some(
          (existingField) => existingField.key === fieldDefinition.key,
        ),
    );

    const needsNameUpdate = currentDefinition.name !== blueprint.name;
    const needsDisplayNameUpdate =
      currentDefinition.displayNameKey !== blueprint.displayNameKey;
    const needsStorefrontAccessUpdate =
      currentDefinition.access?.storefront !== 'PUBLIC_READ';

    if (
      !missingFields.length &&
      !needsNameUpdate &&
      !needsDisplayNameUpdate &&
      !needsStorefrontAccessUpdate
    ) {
      continue;
    }

    const result = await adminGraphql<MetaobjectDefinitionMutationData>(
      admin,
      METAOBJECT_DEFINITION_UPDATE_MUTATION,
      {
        id: currentDefinition.id,
        definition: {
          ...(needsNameUpdate ? {name: blueprint.name} : {}),
          ...(needsDisplayNameUpdate
            ? {displayNameKey: blueprint.displayNameKey}
            : {}),
          ...(needsStorefrontAccessUpdate
            ? {access: {storefront: 'PUBLIC_READ'}}
            : {}),
          ...(missingFields.length
            ? {
                fieldDefinitions: missingFields.map((fieldDefinition) => ({
                  create: fieldDefinition,
                })),
              }
            : {}),
        },
      },
    );

    assertNoUserErrors(
      result.metaobjectDefinitionUpdate?.userErrors,
      `Failed to update ${blueprint.type} definition`,
    );
  }

  configuration = await fetchLoyaltyProgramConfiguration(admin);
  return configuration;
}

async function createMetaobjectDefinition(
  admin: AdminApiContext,
  blueprint: DefinitionBlueprint,
) {
  const result = await adminGraphql<MetaobjectDefinitionMutationData>(
    admin,
    METAOBJECT_DEFINITION_CREATE_MUTATION,
    {
      definition: {
        name: blueprint.name,
        type: blueprint.type,
        description: blueprint.description,
        displayNameKey: blueprint.displayNameKey,
        access: {
          storefront: 'PUBLIC_READ',
        },
        fieldDefinitions: blueprint.fieldDefinitions,
      },
    },
  );

  assertNoUserErrors(
    result.metaobjectDefinitionCreate?.userErrors,
    `Failed to create ${blueprint.type} definition`,
  );
}

async function applyTierEntries(
  admin: AdminApiContext,
  configuration: LoyaltyProgramConfiguration,
  tiers: LoyaltyTierInput[],
) {
  const retainedHandles = new Set<string>();

  for (const tier of tiers) {
    const handle = resolveTierHandle(tier, retainedHandles);

    retainedHandles.add(handle);

    const result = await adminGraphql<MetaobjectUpsertMutationData>(
      admin,
      METAOBJECT_UPSERT_MUTATION,
      {
        handle: {
          type: LOYALTY_METAOBJECT_TYPES.tier,
          handle,
        },
        metaobject: {
          fields: [
            {key: 'label', value: tier.label},
            {key: 'minimum_spend', value: formatDecimal(tier.minimumSpend)},
            {
              key: 'discount_percentage',
              value: formatDecimal(tier.discountPercentage),
            },
          ],
        },
      },
    );

    assertNoUserErrors(
      result.metaobjectUpsert.userErrors,
      `Failed to save tier "${tier.label}"`,
    );
  }

  const removableEntries = configuration.tierEntries.filter(
    (entry) => !retainedHandles.has(entry.handle),
  );

  for (const entry of removableEntries) {
    const result = await adminGraphql<MetaobjectDeleteMutationData>(
      admin,
      METAOBJECT_DELETE_MUTATION,
      {id: entry.id},
    );

    assertNoUserErrors(
      result.metaobjectDelete.userErrors,
      `Failed to delete tier "${entry.handle}"`,
    );
  }
}

const AUTOMATIC_DISCOUNT_EXISTS_QUERY = `#graphql
  query LoyaltyAutomaticDiscountExists($id: ID!) {
    discountNode(id: $id) {
      id
    }
  }
` as const;

/**
 * The automatic discount runs the loyalty function, which applies both tier
 * discounts and redeemed rewards, so it must exist whenever a program does,
 * even if no tier gives a discount.
 */
export async function ensureAutomaticDiscount(
  admin: AdminApiContext,
  configuration: LoyaltyProgramConfiguration,
) {
  if (!configuration.syncPlan.program) {
    return configuration.currentDiscountId;
  }

  const input = {
    title: LOYALTY_DISCOUNT_TITLE,
    functionHandle: LOYALTY_DISCOUNT_FUNCTION_HANDLE,
    startsAt: new Date().toISOString(),
    discountClasses: ['ORDER'],
    combinesWith: {
      orderDiscounts: false,
      productDiscounts: false,
      shippingDiscounts: false,
    },
    tags: ['loyalty', 'managed-by-app'],
  };

  // The saved ID can outlive its discount (deleted in the admin, or removed
  // with a dev preview). Only update a discount that still exists; otherwise
  // create a new one, and the caller saves its ID.
  const saved = configuration.currentDiscountId
    ? await adminGraphql<{discountNode: {id: string} | null}>(
        admin,
        AUTOMATIC_DISCOUNT_EXISTS_QUERY,
        {id: configuration.currentDiscountId},
      )
    : null;

  if (configuration.currentDiscountId && saved?.discountNode) {
    const result = await adminGraphql<DiscountAutomaticMutationData>(
      admin,
      DISCOUNT_AUTOMATIC_APP_UPDATE_MUTATION,
      {
        id: configuration.currentDiscountId,
        automaticAppDiscount: input,
      },
    );

    assertNoUserErrors(
      result.discountAutomaticAppUpdate?.userErrors,
      'Failed to update the loyalty automatic discount',
    );

    return (
      result.discountAutomaticAppUpdate?.automaticAppDiscount?.discountId ??
      configuration.currentDiscountId
    );
  }

  const result = await adminGraphql<DiscountAutomaticMutationData>(
    admin,
    DISCOUNT_AUTOMATIC_APP_CREATE_MUTATION,
    {
      automaticAppDiscount: input,
    },
  );

  assertNoUserErrors(
    result.discountAutomaticAppCreate?.userErrors,
    'Failed to create the loyalty automatic discount',
  );

  return result.discountAutomaticAppCreate?.automaticAppDiscount?.discountId ?? null;
}

async function persistDiscountId(
  admin: AdminApiContext,
  shopId: string,
  discountId: string,
) {
  const result = await adminGraphql<MetafieldsSetMutationData>(
    admin,
    METAFIELDS_SET_MUTATION,
    {
      metafields: [
        {
          ownerId: shopId,
          namespace: APP_METAFIELD_NAMESPACE,
          key: SHOP_LOYALTY_DISCOUNT_ID_KEY,
          type: 'single_line_text_field',
          value: discountId,
        },
      ],
    },
  );

  assertNoUserErrors(
    result.metafieldsSet.userErrors,
    'Failed to persist the loyalty discount identifier',
  );
}

function sanitizeTierInputs(tiers: LoyaltyTierInput[]) {
  if (tiers.length === 0) {
    throw new Error('Add at least one tier before saving the loyalty program.');
  }

  const sanitized = tiers
    .map((tier) => ({
      id: tier.id ?? null,
      handle: tier.handle ?? null,
      label: tier.label.trim(),
      minimumSpend: Number(tier.minimumSpend),
      discountPercentage: Number(tier.discountPercentage),
    }))
    .sort((left, right) => left.minimumSpend - right.minimumSpend);

  const seenThresholds = new Set<number>();

  sanitized.forEach((tier, index) => {
    if (!tier.label) {
      throw new Error(`Tier ${index + 1} is missing a label.`);
    }

    if (!Number.isFinite(tier.minimumSpend) || tier.minimumSpend < 0) {
      throw new Error(`Tier "${tier.label}" must have a valid minimum spend.`);
    }

    if (
      !Number.isFinite(tier.discountPercentage) ||
      tier.discountPercentage < 0 ||
      tier.discountPercentage > 100
    ) {
      throw new Error(
        `Tier "${tier.label}" must have a discount percentage between 0 and 100.`,
      );
    }

    if (seenThresholds.has(tier.minimumSpend)) {
      throw new Error(
        `Minimum spend ${tier.minimumSpend} is duplicated across multiple tiers.`,
      );
    }

    seenThresholds.add(tier.minimumSpend);
  });

  return sanitized;
}

function resolveTierHandle(
  tier: LoyaltyTierInput,
  retainedHandles: Set<string>,
) {
  const preferredHandle = sanitizeHandle(
    tier.handle?.trim() ||
      `${tier.label.toLowerCase()}-${formatHandleNumber(tier.minimumSpend)}`,
  );
  const baseHandle =
    preferredHandle || `tier-${formatHandleNumber(tier.minimumSpend)}`;
  let resolvedHandle = baseHandle;
  let suffix = 2;

  while (retainedHandles.has(resolvedHandle)) {
    resolvedHandle = `${baseHandle}-${suffix}`;
    suffix += 1;
  }

  return resolvedHandle;
}

function sanitizeHandle(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function formatHandleNumber(value: number) {
  return String(value).replace(/[^\d]+/g, '-');
}

function formatDecimal(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
