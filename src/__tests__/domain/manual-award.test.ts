import {describe, it, expect} from 'vitest';
import {projectManualAward, type ManualAwardRule} from '../../domain/customer-state.js';

const rule = (over: Partial<ManualAwardRule> = {}): ManualAwardRule => ({
  handle: 'review-1',
  action: 'review',
  pointsValue: 50,
  active: true,
  repeatable: false,
  ...over,
});

describe('projectManualAward', () => {
  it('awards points to a fresh customer for an eligible one-time rule', () => {
    const r = projectManualAward({rule: rule(), currentBalance: 100, awardedRules: []});
    expect(r.status).toBe('awarded');
    expect(r.pointsAwarded).toBe(50);
    expect(r.newBalance).toBe(150);
    expect(r.newAwardedRules).toEqual(['review-1']);
  });

  it('skips a one-time rule already in awardedRules', () => {
    const r = projectManualAward({rule: rule(), currentBalance: 100, awardedRules: ['review-1']});
    expect(r.status).toBe('already_awarded');
    expect(r.pointsAwarded).toBe(0);
    expect(r.newBalance).toBe(100);
    expect(r.newAwardedRules).toEqual(['review-1']);
  });

  it('re-awards a repeatable rule even if already in awardedRules', () => {
    const r = projectManualAward({
      rule: rule({repeatable: true}),
      currentBalance: 100,
      awardedRules: ['review-1'],
    });
    expect(r.status).toBe('awarded');
    expect(r.newBalance).toBe(150);
    expect(r.newAwardedRules).toEqual(['review-1']);
  });

  it('rejects a rule with null points value', () => {
    const r = projectManualAward({rule: rule({pointsValue: null}), currentBalance: 100, awardedRules: []});
    expect(r.status).toBe('rejected');
    expect(r.newBalance).toBe(100);
  });

  it('rejects a rule with zero or negative points value', () => {
    expect(projectManualAward({rule: rule({pointsValue: 0}), currentBalance: 10, awardedRules: []}).status).toBe('rejected');
    expect(projectManualAward({rule: rule({pointsValue: -5}), currentBalance: 10, awardedRules: []}).status).toBe('rejected');
  });

  it('rejects an inactive rule', () => {
    const r = projectManualAward({rule: rule({active: false}), currentBalance: 100, awardedRules: []});
    expect(r.status).toBe('rejected');
  });

  it('dedupes the handle when appending to awardedRules', () => {
    const r = projectManualAward({rule: rule({handle: 'b'}), currentBalance: 0, awardedRules: ['a']});
    expect(r.newAwardedRules).toEqual(['a', 'b']);
  });
});
