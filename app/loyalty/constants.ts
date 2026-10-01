import {LOYALTY_METAOBJECT_TYPES} from '../../src/domain/program.js';

export const APP_METAFIELD_NAMESPACE = '$app';

export const SHOP_LOYALTY_PROGRAM_SNAPSHOT_KEY = 'loyalty_program_snapshot';
export const SHOP_LOYALTY_PROGRAM_ISSUES_KEY = 'loyalty_program_issues';
export const SHOP_LOYALTY_PROGRAM_SYNCED_AT_KEY = 'loyalty_program_synced_at';
export const SHOP_LOYALTY_DISCOUNT_ID_KEY = 'loyalty_discount_id';
export const SHOP_LOYALTY_PROGRAM_ENABLED_KEY = 'loyalty_program_enabled';
export const SHOP_LOYALTY_DISPLAY_SETTINGS_KEY = 'loyalty_display_settings';

export const CUSTOMER_LOYALTY_STATE_KEY = 'loyalty_state';
export const CUSTOMER_LOYALTY_POINTS_BALANCE_KEY = 'loyalty_points_balance';
export const CUSTOMER_LOYALTY_ACTIVE_REDEMPTION_KEY = 'loyalty_active_redemption';
export const CUSTOMER_LOYALTY_REFERRED_BY_KEY = 'loyalty_referred_by';
export const CUSTOMER_LOYALTY_REFERRED_BY_CREDITED_KEY =
  'loyalty_referred_by_credited';

/**
 * Metaobject types managed by the loyalty engine. Tier + benefit are existing.
 * Earn rule + redemption were added to support points + redemption catalog;
 * they are read alongside tiers when building the program snapshot. See
 * docs/earn-rules-redemptions.md for the merchant-facing schema.
 *
 * Single source of truth: the literal values live in
 * `src/domain/program.ts` (`LOYALTY_METAOBJECT_TYPES`); these named exports are
 * thin aliases so the app layer does not fork the strings (audit M4).
 */
export const LOYALTY_TIER_METAOBJECT_TYPE = LOYALTY_METAOBJECT_TYPES.tier;
export const LOYALTY_BENEFIT_METAOBJECT_TYPE = LOYALTY_METAOBJECT_TYPES.benefit;
export const LOYALTY_EARN_RULE_METAOBJECT_TYPE = LOYALTY_METAOBJECT_TYPES.earnRule;
export const LOYALTY_REDEMPTION_METAOBJECT_TYPE =
  LOYALTY_METAOBJECT_TYPES.redemption;

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
 * Redemption-reward types the discount function applies at checkout.
 * ponytail: no free_shipping until the function has a delivery target;
 * without one it took the points and applied nothing.
 */
export const REDEMPTION_REWARD_TYPES = [
  'fixed_discount',
  'percent_discount',
] as const;

export type RedemptionRewardType = (typeof REDEMPTION_REWARD_TYPES)[number];

/**
 * Earn-rule actions that can be awarded manually from the Customers page.
 * Excludes the actions that already award automatically: `order` (per paid
 * order), `signup` (first-order projection), `referral` (referral credit).
 */
export const MANUAL_EARN_ELIGIBLE_ACTIONS = [
  'birthday',
  'follow_instagram',
  'follow_tiktok',
  'review',
  'newsletter',
  'custom',
] as const;

export function isManualEarnEligible(action: string): boolean {
  return (MANUAL_EARN_ELIGIBLE_ACTIONS as readonly string[]).includes(action);
}
