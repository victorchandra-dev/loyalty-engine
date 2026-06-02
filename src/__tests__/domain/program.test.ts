import {describe, it, expect} from 'vitest';
import {computeOrderPoints, getOneShotEarnPoints, normalizeEarnRuleEntries, LOYALTY_METAOBJECT_TYPES} from '../../domain/program.js';
import type {LoyaltyEarnRuleConfig} from '../../domain/program.js';

const rule = (
  action: LoyaltyEarnRuleConfig['action'],
  pointsValue: number | null,
  active = true,
): LoyaltyEarnRuleConfig => ({id: String(action), handle: String(action), title: String(action), description: null, action, pointsValue, active, repeatable: false});

describe('computeOrderPoints', () => {
  it('awards flat pointsValue from an active order rule', () => {
    expect(computeOrderPoints({orderAmount: 50, earnRules: [rule('order', 10)]})).toBe(10);
  });

  it('awards 1pt per whole currency unit when pointsValue is null', () => {
    expect(computeOrderPoints({orderAmount: 73.99, earnRules: [rule('order', null)]})).toBe(73);
  });

  it('sums multiple active order rules', () => {
    expect(
      computeOrderPoints({
        orderAmount: 100,
        earnRules: [rule('order', 5), rule('order', null)],
      }),
    ).toBe(105);
  });

  it('skips inactive rules', () => {
    expect(computeOrderPoints({orderAmount: 100, earnRules: [rule('order', 20, false)]})).toBe(0);
  });

  it('skips non-order rules', () => {
    expect(computeOrderPoints({orderAmount: 100, earnRules: [rule('signup', 50)]})).toBe(0);
  });

  it('returns 0 for zero amount', () => {
    expect(computeOrderPoints({orderAmount: 0, earnRules: [rule('order', null)]})).toBe(0);
  });

  it('returns 0 for negative amount', () => {
    expect(computeOrderPoints({orderAmount: -10, earnRules: [rule('order', null)]})).toBe(0);
  });
});

describe('getOneShotEarnPoints', () => {
  it('returns pointsValue for an active matching rule', () => {
    expect(getOneShotEarnPoints('signup', [rule('signup', 200)])).toBe(200);
  });

  it('returns 0 for an inactive rule', () => {
    expect(getOneShotEarnPoints('signup', [rule('signup', 200, false)])).toBe(0);
  });

  it('returns 0 when action is not found', () => {
    expect(getOneShotEarnPoints('birthday', [rule('signup', 200)])).toBe(0);
  });

  it('returns 0 when pointsValue is null', () => {
    expect(getOneShotEarnPoints('signup', [rule('signup', null)])).toBe(0);
  });
});

describe('normalizeEarnRuleEntries repeatable', () => {
  const entry = (fields: Record<string, string>) => ({
    id: 'gid://x/1',
    handle: 'review-1',
    type: LOYALTY_METAOBJECT_TYPES.earnRule,
    fields,
  });

  it('reads repeatable=true', () => {
    const {earnRules} = normalizeEarnRuleEntries([
      entry({title: 'Review', action: 'review', active: 'true', repeatable: 'true', points_value: '50'}),
    ]);
    expect(earnRules[0].repeatable).toBe(true);
  });

  it('defaults repeatable to false when the field is absent', () => {
    const {earnRules} = normalizeEarnRuleEntries([
      entry({title: 'Review', action: 'review', active: 'true', points_value: '50'}),
    ]);
    expect(earnRules[0].repeatable).toBe(false);
  });
});
