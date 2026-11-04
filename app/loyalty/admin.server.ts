import type {AdminApiContext} from '@shopify/shopify-app-react-router/server';
import {
  AUTOMATIC_DISCOUNT_DELETE_MUTATION,
  CUSTOMERS_PAGE_QUERY,
  METAFIELDS_DELETE_MUTATION,
  METAFIELD_DEFINITION_CREATE_MUTATION,
  METAFIELD_DEFINITION_QUERY,
  METAFIELD_DEFINITION_UPDATE_MUTATION,
  METAOBJECT_DEFINITION_CREATE_MUTATION,
  METAOBJECT_DEFINITION_UPDATE_MUTATION,
  METAOBJECT_DELETE_MUTATION,
  METAOBJECT_UPSERT_MUTATION,
  METAFIELDS_SET_MUTATION,
  NODES_EXIST_QUERY,
  SEGMENT_CREATE_MUTATION,
  SEGMENT_DELETE_MUTATION,
  SEGMENT_UPDATE_MUTATION,
  TIER_DISCOUNT_CREATE_MUTATION,
  TIER_DISCOUNT_STATE_QUERY,
  TIER_DISCOUNT_UPDATE_MUTATION,
} from '../../src/integrations/shopify/admin-operations.js';
import {LOYALTY_METAOBJECT_TYPES} from '../../src/domain/program.js';
import type {LoyaltyProgramConfig, MerchantMetaobjectEntry} from '../../src/domain/program.js';
import {
  buildTierDiscountPlan,
  type TierDiscountPlanEntry,
} from '../../src/domain/discount-engine.js';
import type {LoyaltyProgramConfiguration} from './program.server';
import {
  fetchLoyaltyProgramConfiguration,
  syncShopProgramSnapshot,
} from './program.server';
import {
  APP_METAFIELD_NAMESPACE,
  SHOP_LOYALTY_DISCOUNT_ID_KEY,
  SHOP_LOYALTY_DISPLAY_SETTINGS_KEY,
  SHOP_LOYALTY_TIER_DISCOUNTS_KEY,
} from './constants';
import {adminGraphql, assertNoUserErrors} from './graphql.server';
import {
  loadLoyaltyCustomer,
  loadProgramSnapshot,
  saveLoyaltyCustomer,
} from './customer-state.server';
import {seedDefaultEarnRulesAndRedemptions} from './earn-rules-redemptions-admin.server';

// ~1 s per customer (one read, one write), so a page stays well inside
// Cloud Run's 60 s request timeout.
const CUSTOMER_SYNC_PAGE_SIZE = 20;

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
 * Recompute one page of customers' tier state from their current spend.
 * Points, one-time awards and any waiting reward are written back exactly as
 * read; a customer that can't be read is skipped, never written with a guess.
 * Returns the cursor of the next page (null when done); the admin page calls
 * again with it until every customer is synced.
 */
export async function backfillCustomerLoyaltyLevels(
  admin: AdminApiContext,
  after: string | null = null,
) {
  const {program} = await loadProgramSnapshot(admin);

  if (!program) {
    throw new Error(
      'The loyalty program is not resolved yet. Initialize the program before syncing customers.',
    );
  }

  const page: CustomersPageQueryData = await adminGraphql<CustomersPageQueryData>(
    admin,
    CUSTOMERS_PAGE_QUERY,
    {first: CUSTOMER_SYNC_PAGE_SIZE, ...(after ? {after} : {})},
  );

  let syncedCustomers = 0;
  let failedCustomers = 0;
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

  return {
    syncedCustomers,
    failedCustomers,
    nextCursor: page.customers.pageInfo.hasNextPage ? page.customers.pageInfo.endCursor : null,
  };
}

export async function reconcileLoyaltyProgram(admin: AdminApiContext) {
  const configuration = await syncShopProgramSnapshot(admin);
  await syncTierDiscounts(admin, configuration.syncPlan.program);
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

// The fields the storefront reads, and who may read them. These are declared
// in shopify.app.loyaltyflow.toml too, but Shopify never created those
// definitions (found on 2 Oct: none on either store), and without one the
// Customer Account API returns null, so the storefront showed 0 points.
const STOREFRONT_READABLE_DEFINITIONS = [
  ...(['loyalty_state', 'loyalty_points_balance', 'loyalty_active_redemption'] as const).map((key) => ({
    ownerType: 'CUSTOMER',
    key,
    type: key === 'loyalty_points_balance' ? 'number_integer' : 'json',
    access: {admin: 'MERCHANT_READ', customerAccount: 'READ'},
  })),
  {
    ownerType: 'SHOP',
    key: SHOP_LOYALTY_DISPLAY_SETTINGS_KEY,
    type: 'json',
    access: {admin: 'MERCHANT_READ', storefront: 'PUBLIC_READ'},
  },
] as const;

/**
 * Create (or fix the access of) every field definition the storefront needs.
 * ponytail: one lookup per field; four fields, run only on Initialize/save.
 */
export async function ensureStorefrontReadableDefinitions(admin: AdminApiContext) {
  for (const {ownerType, key, type, access} of STOREFRONT_READABLE_DEFINITIONS) {
    const identifier = {ownerType, namespace: '$app', key};
    const {metafieldDefinition: existing} = await adminGraphql<{
      metafieldDefinition: {id: string; access: {customerAccount: string; storefront: string}} | null;
    }>(admin, METAFIELD_DEFINITION_QUERY, {identifier});

    if (!existing) {
      await mutate(admin, METAFIELD_DEFINITION_CREATE_MUTATION, {
        definition: {...identifier, name: key, type, access},
      }, 'metafieldDefinitionCreate', `Failed to create the ${key} field definition`);
      continue;
    }
    const readable = 'customerAccount' in access
      ? existing.access.customerAccount === access.customerAccount
      : existing.access.storefront === access.storefront;
    if (!readable) {
      await mutate(admin, METAFIELD_DEFINITION_UPDATE_MUTATION, {
        definition: {...identifier, access},
      }, 'metafieldDefinitionUpdate', `Failed to update the ${key} field definition`);
    }
  }
}

export async function ensureLoyaltyDefinitions(admin: AdminApiContext) {
  await ensureStorefrontReadableDefinitions(admin);
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

/** Saved IDs of the built-in segment + discount behind each discount tier. */
type TierDiscountIds = Record<string, {segmentId: string; discountId: string}>;

type MutationResult = {userErrors: MutationUserError[]};

async function mutate<T extends MutationResult = MutationResult>(
  admin: AdminApiContext,
  mutation: string,
  variables: Record<string, unknown>,
  root: string,
  label: string,
): Promise<T> {
  const data = await adminGraphql<Record<string, T | undefined>>(admin, mutation, variables);
  assertNoUserErrors(data[root]?.userErrors, label);
  return data[root]!;
}

/**
 * Keep Shopify's built-in discounts in step with the program's tiers: one
 * customer segment (spend range) and one automatic % discount limited to it
 * per discount tier. Custom apps can't run Functions on non-Plus stores, so
 * this replaces the old loyalty-discount Function.
 *
 * Tier discounts combine with other order discounts so a redeemed reward code
 * stacks on top (owner's call); the exclusive spend ranges stop tier
 * discounts stacking with each other.
 *
 * ponytail: the ID map is saved once at the end. If a sync dies after creating
 * a segment, the next sync fails on the duplicate segment name; delete that
 * segment under Customers → Segments and sync again.
 */
export async function syncTierDiscounts(
  admin: AdminApiContext,
  program: LoyaltyProgramConfig | null,
) {
  const {shop} = await adminGraphql<{
    shop: {
      id: string;
      tierDiscounts: {value: string} | null;
      legacyDiscount: {value: string} | null;
      enabled: {value: string} | null;
    };
  }>(admin, TIER_DISCOUNT_STATE_QUERY);

  const saved = parseTierDiscountIds(shop.tierDiscounts?.value);
  const savedIds = Object.values(saved).flatMap((ids) => [ids.segmentId, ids.discountId]);
  const existing = new Set<string>(
    savedIds.length
      ? (
          await adminGraphql<{nodes: Array<{id: string} | null>}>(admin, NODES_EXIST_QUERY, {ids: savedIds})
        ).nodes.flatMap((node) => (node ? [node.id] : []))
      : [],
  );

  const remove = async (ids: {segmentId: string; discountId: string}) => {
    if (existing.has(ids.discountId)) {
      await mutate(admin, AUTOMATIC_DISCOUNT_DELETE_MUTATION, {id: ids.discountId}, 'discountAutomaticDelete', 'Failed to delete a tier discount');
    }
    if (existing.has(ids.segmentId)) {
      await mutate(admin, SEGMENT_DELETE_MUTATION, {id: ids.segmentId}, 'segmentDelete', 'Failed to delete a tier segment');
    }
  };

  const next: TierDiscountIds = {};
  // Built-in discounts don't see the program's on/off switch (the Function
  // did), so a paused program removes them and Activate recreates them.
  const paused = shop.enabled?.value === 'false';
  for (const entry of program && !paused ? buildTierDiscountPlan(program) : []) {
    const previous = saved[entry.tierHandle];
    if (previous && existing.has(previous.segmentId) && existing.has(previous.discountId)) {
      await mutate(admin, SEGMENT_UPDATE_MUTATION, {id: previous.segmentId, ...segmentFields(entry)}, 'segmentUpdate', `Failed to update the ${entry.title} segment`);
      await mutate(admin, TIER_DISCOUNT_UPDATE_MUTATION, {id: previous.discountId, discount: tierDiscountFields(entry)}, 'discountAutomaticBasicUpdate', `Failed to update the ${entry.title} discount`);
      next[entry.tierHandle] = previous;
      continue;
    }
    if (previous) await remove(previous);
    const segment = await mutate<MutationResult & {segment: {id: string}}>(admin, SEGMENT_CREATE_MUTATION, segmentFields(entry), 'segmentCreate', `Failed to create the ${entry.title} segment`);
    const segmentId = segment.segment.id;
    const discount = await mutate<MutationResult & {automaticDiscountNode: {id: string}}>(admin, TIER_DISCOUNT_CREATE_MUTATION, {
      discount: {
        ...tierDiscountFields(entry),
        startsAt: new Date().toISOString(),
        context: {customerSegments: {add: [segmentId]}},
      },
    }, 'discountAutomaticBasicCreate', `Failed to create the ${entry.title} discount`);
    next[entry.tierHandle] = {segmentId, discountId: discount.automaticDiscountNode.id};
  }

  for (const [handle, ids] of Object.entries(saved)) {
    if (!next[handle]) await remove(ids);
  }

  // The old Function-based discount can't run off Plus; remove it for good.
  if (shop.legacyDiscount?.value) {
    await adminGraphql(admin, AUTOMATIC_DISCOUNT_DELETE_MUTATION, {id: shop.legacyDiscount.value}).catch(() => {});
    await mutate(admin, METAFIELDS_DELETE_MUTATION, {
      metafields: [{ownerId: shop.id, namespace: APP_METAFIELD_NAMESPACE, key: SHOP_LOYALTY_DISCOUNT_ID_KEY}],
    }, 'metafieldsDelete', 'Failed to clear the old discount ID');
  }

  await mutate(admin, METAFIELDS_SET_MUTATION, {
    metafields: [{
      ownerId: shop.id,
      namespace: APP_METAFIELD_NAMESPACE,
      key: SHOP_LOYALTY_TIER_DISCOUNTS_KEY,
      type: 'json',
      value: JSON.stringify(next),
    }],
  }, 'metafieldsSet', 'Failed to save the tier discount IDs');

  return next;
}

function segmentFields(entry: TierDiscountPlanEntry) {
  return {name: `LoyaltyFlow · ${entry.title}`, query: entry.segmentQuery};
}

function tierDiscountFields(entry: TierDiscountPlanEntry) {
  return {
    title: entry.title,
    customerGets: {value: {percentage: entry.percentage / 100}, items: {all: true}},
    combinesWith: {orderDiscounts: true, productDiscounts: false, shippingDiscounts: true},
  };
}

function parseTierDiscountIds(value: string | null | undefined): TierDiscountIds {
  try {
    const parsed = value ? (JSON.parse(value) as unknown) : null;
    return parsed && typeof parsed === 'object' ? (parsed as TierDiscountIds) : {};
  } catch {
    return {};
  }
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
