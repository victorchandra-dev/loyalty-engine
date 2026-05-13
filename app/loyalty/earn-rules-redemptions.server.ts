import type {AdminApiContext} from '@shopify/shopify-app-react-router/server';
import {adminGraphql} from './graphql.server';
import {
  EARN_RULE_ACTIONS,
  LOYALTY_EARN_RULE_METAOBJECT_TYPE,
  LOYALTY_REDEMPTION_METAOBJECT_TYPE,
  REDEMPTION_REWARD_TYPES,
  type EarnRuleAction,
  type RedemptionRewardType,
} from './constants';

/**
 * Server-side helpers for the new earn-rule + redemption metaobject types.
 *
 * These are READ-ONLY for now — the engine fetches merchant-defined rules from
 * Shopify metaobjects and normalises them. Awarding points (orders/paid),
 * applying redemption discounts (function extension), and admin-side editing
 * are wired in follow-up work; this module is the foundation everything else
 * builds on so the data shape is committed.
 *
 * Schema each metaobject must define in Shopify Admin → Settings → Custom data:
 *
 * Type: loyalty_earn_rule
 *   handle:        single-line text (machine identifier, e.g. "signup")
 *   title:         single-line text (storefront label)
 *   description:   multi-line text (optional)
 *   action:        single-line text — one of EARN_RULE_ACTIONS
 *   points_value:  number_integer (optional; null means dynamic, e.g. "1pt/$1")
 *   active:        boolean (default true)
 *
 * Type: loyalty_redemption
 *   handle:        single-line text
 *   title:         single-line text
 *   description:   multi-line text (optional)
 *   points_cost:   number_integer
 *   reward_type:   single-line text — one of REDEMPTION_REWARD_TYPES
 *   reward_value:  single-line text (optional, e.g. "10" for $10 off)
 *   active:        boolean (default true)
 */

const EARN_RULES_QUERY = /* GraphQL */ `
  query LoyaltyEarnRules($type: String!, $first: Int!) {
    metaobjects(type: $type, first: $first) {
      nodes {
        id
        handle
        fields {
          key
          value
        }
      }
    }
  }
`;

const REDEMPTIONS_QUERY = EARN_RULES_QUERY;

type MetaobjectNode = {
  id: string;
  handle: string;
  fields: Array<{key: string; value: string | null}>;
};

type MetaobjectsQueryResult = {
  metaobjects: {nodes: MetaobjectNode[]};
};

export type EngineEarnRule = {
  id: string;
  handle: string;
  title: string;
  description: string | null;
  action: EarnRuleAction | string; // unknown actions kept for storefront display
  pointsValue: number | null;
  active: boolean;
};

export type EngineRedemption = {
  id: string;
  handle: string;
  title: string;
  description: string | null;
  pointsCost: number;
  rewardType: RedemptionRewardType | string;
  rewardValue: string | null;
  active: boolean;
};

export async function fetchEarnRules(
  admin: AdminApiContext,
): Promise<EngineEarnRule[]> {
  const result = await adminGraphql<MetaobjectsQueryResult>(
    admin,
    EARN_RULES_QUERY,
    {type: LOYALTY_EARN_RULE_METAOBJECT_TYPE, first: 50},
  );
  return result.metaobjects.nodes
    .map(toEarnRule)
    .filter((rule): rule is EngineEarnRule => rule !== null);
}

export async function fetchRedemptions(
  admin: AdminApiContext,
): Promise<EngineRedemption[]> {
  const result = await adminGraphql<MetaobjectsQueryResult>(
    admin,
    REDEMPTIONS_QUERY,
    {type: LOYALTY_REDEMPTION_METAOBJECT_TYPE, first: 50},
  );
  return result.metaobjects.nodes
    .map(toRedemption)
    .filter((reward): reward is EngineRedemption => reward !== null);
}

function toEarnRule(node: MetaobjectNode): EngineEarnRule | null {
  const fields = fieldMap(node.fields);
  const title = fields.title?.trim();
  const action = fields.action?.trim();

  if (!title || !action) return null;

  return {
    id: node.id,
    handle: node.handle,
    title,
    description: fields.description?.trim() || null,
    action: isKnownEarnAction(action) ? action : action,
    pointsValue: parseIntegerOrNull(fields.points_value),
    active: parseBoolean(fields.active, true),
  };
}

function toRedemption(node: MetaobjectNode): EngineRedemption | null {
  const fields = fieldMap(node.fields);
  const title = fields.title?.trim();
  const rewardType = fields.reward_type?.trim();
  const pointsCost = parseIntegerOrNull(fields.points_cost);

  if (!title || !rewardType || pointsCost === null) return null;

  return {
    id: node.id,
    handle: node.handle,
    title,
    description: fields.description?.trim() || null,
    pointsCost,
    rewardType: isKnownRewardType(rewardType) ? rewardType : rewardType,
    rewardValue: fields.reward_value?.trim() || null,
    active: parseBoolean(fields.active, true),
  };
}

function fieldMap(fields: Array<{key: string; value: string | null}>) {
  const result: Record<string, string | null | undefined> = {};
  for (const field of fields) {
    result[field.key] = field.value;
  }
  return result;
}

function parseIntegerOrNull(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBoolean(
  value: string | null | undefined,
  defaultValue: boolean,
): boolean {
  if (value === null || value === undefined || value === '') {
    return defaultValue;
  }
  return value === 'true' || value === '1';
}

function isKnownEarnAction(value: string): value is EarnRuleAction {
  return (EARN_RULE_ACTIONS as readonly string[]).includes(value);
}

function isKnownRewardType(value: string): value is RedemptionRewardType {
  return (REDEMPTION_REWARD_TYPES as readonly string[]).includes(value);
}
