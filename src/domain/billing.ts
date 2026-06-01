/**
 * Free-tier caps for the loyalty program. Set to the default seed size
 * (DEFAULT_TIER_SEEDS / DEFAULT_EARN_RULE_SEEDS both seed 3 entries) so a fresh
 * install is never born over the limit. Pro lifts the cap entirely.
 *
 * Pure module: no Shopify imports, so the gate is unit-testable in isolation.
 */
export const FREE_TIER_MAX_TIERS = 3;
export const FREE_TIER_MAX_EARN_RULES = 3;

/** True when saving `count` tiers is not allowed on the current plan. */
export function exceedsTierLimit(count: number, isPro: boolean): boolean {
  if (isPro) return false;
  return count > FREE_TIER_MAX_TIERS;
}

/** True when saving `count` earn rules is not allowed on the current plan. */
export function exceedsEarnRuleLimit(count: number, isPro: boolean): boolean {
  if (isPro) return false;
  return count > FREE_TIER_MAX_EARN_RULES;
}
