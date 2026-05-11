export const APP_METAFIELD_NAMESPACE = '$app';

export const SHOP_LOYALTY_PROGRAM_SNAPSHOT_KEY = 'loyalty_program_snapshot';
export const SHOP_LOYALTY_PROGRAM_ISSUES_KEY = 'loyalty_program_issues';
export const SHOP_LOYALTY_PROGRAM_SYNCED_AT_KEY = 'loyalty_program_synced_at';
export const SHOP_LOYALTY_DISCOUNT_ID_KEY = 'loyalty_discount_id';
export const SHOP_LOYALTY_PROGRAM_ENABLED_KEY = 'loyalty_program_enabled';

export const CUSTOMER_LOYALTY_STATE_KEY = 'loyalty_state';
export const CUSTOMER_LOYALTY_POINTS_BALANCE_KEY = 'loyalty_points_balance';
export const CUSTOMER_LOYALTY_ACTIVE_REDEMPTION_KEY = 'loyalty_active_redemption';

/**
 * Default lifetime of an applied redemption before the discount function
 * stops honouring it (24 hours). The redemption helper sets `expiresAt` based
 * on this when writing the metafield, and the function ignores expired
 * records. Reasonable for one-checkout reservations; tune per merchant.
 */
export const REDEMPTION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Metaobject types managed by the loyalty engine. Tier + benefit are existing.
 * Earn rule + redemption were added to support points + redemption catalog;
 * they are read alongside tiers when building the program snapshot. See
 * docs/earn-rules-redemptions.md for the merchant-facing schema.
 */
export const LOYALTY_TIER_METAOBJECT_TYPE = 'loyalty_reward_tier';
export const LOYALTY_BENEFIT_METAOBJECT_TYPE = 'loyalty_reward_benefit';
export const LOYALTY_EARN_RULE_METAOBJECT_TYPE = 'loyalty_earn_rule';
export const LOYALTY_REDEMPTION_METAOBJECT_TYPE = 'loyalty_redemption';

/**
 * Earn-rule action codes recognised by the engine. New codes can be added
 * without breaking existing rules — unknown codes are surfaced verbatim in the
 * storefront and skipped by the points-awarding worker.
 */
export const EARN_RULE_ACTIONS = [
  'signup',
  'order',
  'birthday',
  'follow_instagram',
  'follow_tiktok',
  'review',
  'referral',
  'newsletter',
  'custom',
] as const;

export type EarnRuleAction = (typeof EARN_RULE_ACTIONS)[number];

/**
 * Redemption-reward types. The discount function extension applies all three
 * at checkout: fixed-amount discount, percent discount, free shipping.
 */
export const REDEMPTION_REWARD_TYPES = [
  'fixed_discount',
  'percent_discount',
  'free_shipping',
] as const;

export type RedemptionRewardType = (typeof REDEMPTION_REWARD_TYPES)[number];
