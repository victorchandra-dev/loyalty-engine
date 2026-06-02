import type {AdminApiContext} from '@shopify/shopify-app-react-router/server';
import {
  METAOBJECT_DELETE_MUTATION,
  METAOBJECT_UPSERT_MUTATION,
} from '../../src/integrations/shopify/admin-operations.js';
import {LOYALTY_METAOBJECT_TYPES} from '../../src/domain/program.js';
import type {MerchantMetaobjectEntry} from '../../src/domain/program.js';
import {
  EARN_RULE_ACTIONS,
  REDEMPTION_REWARD_TYPES,
  type EarnRuleAction,
  type RedemptionRewardType,
} from './constants';
import {adminGraphql, assertNoUserErrors} from './graphql.server';
import type {LoyaltyProgramConfiguration} from './program.server';
import {fetchLoyaltyProgramConfiguration, syncShopProgramSnapshot} from './program.server';

/**
 * Editor + persistence helpers for earn rules and redemptions, mirroring the
 * pattern used by saveTierConfiguration / applyTierEntries / buildTierEditorEntries
 * but kept in a separate module to avoid bloating admin.server.ts.
 */

export type LoyaltyEarnRuleEditorEntry = {
  id: string | null;
  handle: string | null;
  title: string;
  description: string;
  action: string;
  pointsValue: string; // string for the form, parsed on save
  active: string; // 'true' | 'false'
  repeatable: string; // 'true' | 'false'
};

export type LoyaltyEarnRuleInput = {
  id?: string | null;
  handle?: string | null;
  title: string;
  description?: string;
  action: string;
  pointsValue: number | null;
  active: boolean;
  repeatable: boolean;
};

export type LoyaltyRedemptionEditorEntry = {
  id: string | null;
  handle: string | null;
  title: string;
  description: string;
  pointsCost: string;
  rewardType: string;
  rewardValue: string;
  active: string;
};

export type LoyaltyRedemptionInput = {
  id?: string | null;
  handle?: string | null;
  title: string;
  description?: string;
  pointsCost: number;
  rewardType: string;
  rewardValue?: string;
  active: boolean;
};

type MutationUserError = {
  field?: Array<string | number> | null;
  message: string;
  code?: string | null;
};

type MetaobjectMutationPayload = {
  userErrors: MutationUserError[];
};

type MetaobjectUpsertMutationData = {
  metaobjectUpsert: MetaobjectMutationPayload;
};

type MetaobjectDeleteMutationData = {
  metaobjectDelete: MetaobjectMutationPayload;
};

export const DEFAULT_EARN_RULE_SEEDS: LoyaltyEarnRuleInput[] = [
  {
    handle: 'signup',
    title: 'Create an account',
    description: 'Welcome bonus when a customer joins.',
    action: 'signup',
    pointsValue: 200,
    active: true,
    repeatable: false,
  },
  {
    handle: 'order',
    title: 'Place an order',
    description: 'Earn 1 point for every whole currency unit spent.',
    action: 'order',
    pointsValue: null,
    active: true,
    repeatable: false,
  },
  {
    handle: 'referral',
    title: 'Refer a friend',
    description: 'Awarded after a referred customer places their first order.',
    action: 'referral',
    pointsValue: 500,
    active: true,
    repeatable: false,
  },
];

export const DEFAULT_REDEMPTION_SEEDS: LoyaltyRedemptionInput[] = [
  {
    handle: 'discount-10',
    title: '$10 off your order',
    pointsCost: 500,
    rewardType: 'fixed_discount',
    rewardValue: '10',
    active: true,
  },
  {
    handle: 'discount-25',
    title: '$25 off your order',
    pointsCost: 1000,
    rewardType: 'fixed_discount',
    rewardValue: '25',
    active: true,
  },
];

// ---- Editor entry builders ---------------------------------------------------

export function buildEarnRuleEditorEntries(
  entries: MerchantMetaobjectEntry[],
): LoyaltyEarnRuleEditorEntry[] {
  const rows = entries.reduce<LoyaltyEarnRuleEditorEntry[]>((acc, entry) => {
    const title = entry.fields.title?.trim();
    const action = entry.fields.action?.trim();
    if (!title || !action) return acc;
    acc.push({
      id: entry.id,
      handle: entry.handle,
      title,
      description: entry.fields.description?.trim() ?? '',
      action,
      pointsValue: entry.fields.points_value?.trim() ?? '',
      active: entry.fields.active?.trim() ?? 'true',
      repeatable: entry.fields.repeatable?.trim() ?? 'false',
    });
    return acc;
  }, []);

  return rows.length > 0
    ? rows
    : DEFAULT_EARN_RULE_SEEDS.map((seed) => ({
        id: null,
        handle: seed.handle ?? null,
        title: seed.title,
        description: seed.description ?? '',
        action: seed.action,
        pointsValue: seed.pointsValue === null ? '' : String(seed.pointsValue),
        active: seed.active ? 'true' : 'false',
        repeatable: seed.repeatable ? 'true' : 'false',
      }));
}

export function buildRedemptionEditorEntries(
  entries: MerchantMetaobjectEntry[],
): LoyaltyRedemptionEditorEntry[] {
  const rows = entries.reduce<LoyaltyRedemptionEditorEntry[]>((acc, entry) => {
    const title = entry.fields.title?.trim();
    const rewardType = entry.fields.reward_type?.trim();
    const pointsCost = entry.fields.points_cost?.trim();
    if (!title || !rewardType || !pointsCost) return acc;
    acc.push({
      id: entry.id,
      handle: entry.handle,
      title,
      description: entry.fields.description?.trim() ?? '',
      pointsCost,
      rewardType,
      rewardValue: entry.fields.reward_value?.trim() ?? '',
      active: entry.fields.active?.trim() ?? 'true',
    });
    return acc;
  }, []);

  return rows.length > 0
    ? rows
    : DEFAULT_REDEMPTION_SEEDS.map((seed) => ({
        id: null,
        handle: seed.handle ?? null,
        title: seed.title,
        description: seed.description ?? '',
        pointsCost: String(seed.pointsCost),
        rewardType: seed.rewardType,
        rewardValue: seed.rewardValue ?? '',
        active: seed.active ? 'true' : 'false',
      }));
}

// ---- Save functions ----------------------------------------------------------

export async function saveEarnRuleConfiguration({
  admin,
  earnRules,
}: {
  admin: AdminApiContext;
  earnRules: LoyaltyEarnRuleInput[];
}) {
  const sanitized = sanitizeEarnRuleInputs(earnRules);
  const configuration = await fetchLoyaltyProgramConfiguration(admin);

  await applyEarnRuleEntries(admin, configuration, sanitized);
  await syncShopProgramSnapshot(admin);

  const refreshed = await fetchLoyaltyProgramConfiguration(admin);
  return {
    configuration: refreshed,
    earnRules: buildEarnRuleEditorEntries(refreshed.earnRuleEntries),
  };
}

export async function saveRedemptionConfiguration({
  admin,
  redemptions,
}: {
  admin: AdminApiContext;
  redemptions: LoyaltyRedemptionInput[];
}) {
  const sanitized = sanitizeRedemptionInputs(redemptions);
  const configuration = await fetchLoyaltyProgramConfiguration(admin);

  await applyRedemptionEntries(admin, configuration, sanitized);
  await syncShopProgramSnapshot(admin);

  const refreshed = await fetchLoyaltyProgramConfiguration(admin);
  return {
    configuration: refreshed,
    redemptions: buildRedemptionEditorEntries(refreshed.redemptionEntries),
  };
}

export async function seedDefaultEarnRulesAndRedemptions({
  admin,
  configuration,
}: {
  admin: AdminApiContext;
  configuration: LoyaltyProgramConfiguration;
}) {
  if (configuration.earnRuleEntries.length === 0) {
    await applyEarnRuleEntries(admin, configuration, DEFAULT_EARN_RULE_SEEDS);
  }

  if (configuration.redemptionEntries.length === 0) {
    await applyRedemptionEntries(
      admin,
      configuration,
      DEFAULT_REDEMPTION_SEEDS,
    );
  }
}

// ---- Apply (upsert + delete) -------------------------------------------------

async function applyEarnRuleEntries(
  admin: AdminApiContext,
  configuration: LoyaltyProgramConfiguration,
  rules: LoyaltyEarnRuleInput[],
) {
  const retainedHandles = new Set<string>();

  for (const rule of rules) {
    const handle = resolveHandle(
      rule.handle ?? null,
      `${rule.action}-${rule.title}`,
      retainedHandles,
      'earn-rule',
    );
    retainedHandles.add(handle);

    const fields: Array<{key: string; value: string}> = [
      {key: 'title', value: rule.title},
      {key: 'action', value: rule.action},
      {key: 'active', value: rule.active ? 'true' : 'false'},
      {key: 'repeatable', value: rule.repeatable ? 'true' : 'false'},
    ];
    if (rule.description) {
      fields.push({key: 'description', value: rule.description});
    }
    if (rule.pointsValue !== null) {
      fields.push({key: 'points_value', value: String(rule.pointsValue)});
    }

    const result = await adminGraphql<MetaobjectUpsertMutationData>(
      admin,
      METAOBJECT_UPSERT_MUTATION,
      {
        handle: {type: LOYALTY_METAOBJECT_TYPES.earnRule, handle},
        metaobject: {fields},
      },
    );
    assertNoUserErrors(
      result.metaobjectUpsert.userErrors,
      `Failed to save earn rule "${rule.title}"`,
    );
  }

  const removable = configuration.earnRuleEntries.filter(
    (entry) => !retainedHandles.has(entry.handle),
  );
  for (const entry of removable) {
    const result = await adminGraphql<MetaobjectDeleteMutationData>(
      admin,
      METAOBJECT_DELETE_MUTATION,
      {id: entry.id},
    );
    assertNoUserErrors(
      result.metaobjectDelete.userErrors,
      `Failed to delete earn rule "${entry.handle}"`,
    );
  }
}

async function applyRedemptionEntries(
  admin: AdminApiContext,
  configuration: LoyaltyProgramConfiguration,
  redemptions: LoyaltyRedemptionInput[],
) {
  const retainedHandles = new Set<string>();

  for (const reward of redemptions) {
    const handle = resolveHandle(
      reward.handle ?? null,
      `${reward.rewardType}-${reward.title}`,
      retainedHandles,
      'redemption',
    );
    retainedHandles.add(handle);

    const fields: Array<{key: string; value: string}> = [
      {key: 'title', value: reward.title},
      {key: 'reward_type', value: reward.rewardType},
      {key: 'points_cost', value: String(reward.pointsCost)},
      {key: 'active', value: reward.active ? 'true' : 'false'},
    ];
    if (reward.description) {
      fields.push({key: 'description', value: reward.description});
    }
    if (reward.rewardValue) {
      fields.push({key: 'reward_value', value: reward.rewardValue});
    }

    const result = await adminGraphql<MetaobjectUpsertMutationData>(
      admin,
      METAOBJECT_UPSERT_MUTATION,
      {
        handle: {type: LOYALTY_METAOBJECT_TYPES.redemption, handle},
        metaobject: {fields},
      },
    );
    assertNoUserErrors(
      result.metaobjectUpsert.userErrors,
      `Failed to save redemption "${reward.title}"`,
    );
  }

  const removable = configuration.redemptionEntries.filter(
    (entry) => !retainedHandles.has(entry.handle),
  );
  for (const entry of removable) {
    const result = await adminGraphql<MetaobjectDeleteMutationData>(
      admin,
      METAOBJECT_DELETE_MUTATION,
      {id: entry.id},
    );
    assertNoUserErrors(
      result.metaobjectDelete.userErrors,
      `Failed to delete redemption "${entry.handle}"`,
    );
  }
}

// ---- Sanitization ------------------------------------------------------------

function sanitizeEarnRuleInputs(rules: LoyaltyEarnRuleInput[]) {
  if (rules.length === 0) return [];

  const sanitized = rules.map((rule, index) => {
    const title = rule.title?.trim() ?? '';
    const action = rule.action?.trim() ?? '';

    if (!title) {
      throw new Error(`Earn rule ${index + 1} is missing a title.`);
    }
    if (!action) {
      throw new Error(`Earn rule "${title}" is missing an action code.`);
    }
    if (
      !(EARN_RULE_ACTIONS as readonly string[]).includes(action) &&
      action !== 'custom'
    ) {
      // Allow unknown codes (forward-compat) but warn via a soft cap
      // The domain normaliser will surface a warning issue.
    }

    const pointsValue =
      rule.pointsValue === null || rule.pointsValue === undefined
        ? null
        : Number(rule.pointsValue);
    if (
      pointsValue !== null &&
      (!Number.isFinite(pointsValue) || pointsValue < 0)
    ) {
      throw new Error(
        `Earn rule "${title}" must have a non-negative points value or no value at all.`,
      );
    }

    return {
      id: rule.id ?? null,
      handle: rule.handle ?? null,
      title,
      description: rule.description?.trim() ?? '',
      action: action as EarnRuleAction | string,
      pointsValue,
      active: rule.active !== false,
      repeatable: rule.repeatable === true,
    } satisfies LoyaltyEarnRuleInput;
  });

  // De-dupe handles for sanity (full collision resolution happens in resolveHandle)
  const seenTitles = new Set<string>();
  for (const rule of sanitized) {
    const key = `${rule.action}::${rule.title.toLowerCase()}`;
    if (seenTitles.has(key)) {
      throw new Error(
        `Earn rule "${rule.title}" with action "${rule.action}" is duplicated.`,
      );
    }
    seenTitles.add(key);
  }

  return sanitized;
}

function sanitizeRedemptionInputs(rewards: LoyaltyRedemptionInput[]) {
  if (rewards.length === 0) return [];

  const sanitized = rewards.map((reward, index) => {
    const title = reward.title?.trim() ?? '';
    const rewardType = reward.rewardType?.trim() ?? '';
    const pointsCost = Number(reward.pointsCost);

    if (!title) {
      throw new Error(`Redemption ${index + 1} is missing a title.`);
    }
    if (!rewardType) {
      throw new Error(`Redemption "${title}" is missing a reward type.`);
    }
    if (!Number.isFinite(pointsCost) || pointsCost < 0) {
      throw new Error(
        `Redemption "${title}" must have a non-negative points cost.`,
      );
    }
    if (
      !(REDEMPTION_REWARD_TYPES as readonly string[]).includes(rewardType)
    ) {
      // Forward-compat: warn but allow.
    }

    return {
      id: reward.id ?? null,
      handle: reward.handle ?? null,
      title,
      description: reward.description?.trim() ?? '',
      pointsCost,
      rewardType: rewardType as RedemptionRewardType | string,
      rewardValue: reward.rewardValue?.trim() ?? '',
      active: reward.active !== false,
    } satisfies LoyaltyRedemptionInput;
  });

  return sanitized;
}

function resolveHandle(
  preferred: string | null,
  fallback: string,
  retained: Set<string>,
  prefix: string,
) {
  const base = sanitizeHandle(preferred?.trim() || fallback) || prefix;
  let resolved = base;
  let suffix = 2;
  while (retained.has(resolved)) {
    resolved = `${base}-${suffix}`;
    suffix += 1;
  }
  return resolved;
}

function sanitizeHandle(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
