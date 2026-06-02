import {describe, it, expect} from 'vitest';
import {
  MANUAL_EARN_ELIGIBLE_ACTIONS,
  isManualEarnEligible,
} from '../../../app/loyalty/constants.js';

describe('isManualEarnEligible', () => {
  it('is true for the six manually-awarded actions', () => {
    for (const action of ['birthday', 'follow_instagram', 'follow_tiktok', 'review', 'newsletter', 'custom']) {
      expect(isManualEarnEligible(action)).toBe(true);
    }
  });

  it('is false for the auto-awarded actions', () => {
    for (const action of ['order', 'signup', 'referral']) {
      expect(isManualEarnEligible(action)).toBe(false);
    }
  });

  it('exposes the eligible set', () => {
    expect(MANUAL_EARN_ELIGIBLE_ACTIONS).toContain('review');
    expect(MANUAL_EARN_ELIGIBLE_ACTIONS).not.toContain('order');
  });
});
