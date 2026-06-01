import {describe, it, expect} from 'vitest';
import {
  FREE_TIER_MAX_TIERS,
  FREE_TIER_MAX_EARN_RULES,
  exceedsTierLimit,
  exceedsEarnRuleLimit,
} from '../../domain/billing.js';

describe('exceedsTierLimit', () => {
  it('never limits Pro merchants', () => {
    expect(exceedsTierLimit(1, true)).toBe(false);
    expect(exceedsTierLimit(100, true)).toBe(false);
  });

  it('allows Free merchants up to the cap', () => {
    expect(exceedsTierLimit(1, false)).toBe(false);
    expect(exceedsTierLimit(FREE_TIER_MAX_TIERS, false)).toBe(false);
  });

  it('blocks Free merchants above the cap', () => {
    expect(exceedsTierLimit(FREE_TIER_MAX_TIERS + 1, false)).toBe(true);
  });
});

describe('exceedsEarnRuleLimit', () => {
  it('never limits Pro merchants', () => {
    expect(exceedsEarnRuleLimit(100, true)).toBe(false);
  });

  it('allows Free merchants up to the cap and blocks above', () => {
    expect(exceedsEarnRuleLimit(FREE_TIER_MAX_EARN_RULES, false)).toBe(false);
    expect(exceedsEarnRuleLimit(FREE_TIER_MAX_EARN_RULES + 1, false)).toBe(true);
  });
});

describe('cap constants', () => {
  it('match the default seed size of 3', () => {
    expect(FREE_TIER_MAX_TIERS).toBe(3);
    expect(FREE_TIER_MAX_EARN_RULES).toBe(3);
  });
});
