import {describe, it, expect} from 'vitest';
import {describePointsEvent} from '../../domain/points-event-copy.js';

const row = (type: string, data: unknown = null, orderId: string | null = null) => ({type, data, orderId});

describe('describePointsEvent', () => {
  it.each([
    ['order', 'Earned from order'],
    ['signup', 'Sign-up bonus'],
    ['referral', 'Referral bonus'],
    ['refund', 'Taken back after a refund'],
  ])('describes %s rows', (type, text) => {
    expect(describePointsEvent(row(type)).text).toBe(text);
  });

  it('names the reward and code of a redeem', () => {
    expect(describePointsEvent(row('redeem', {title: '$10 off', code: 'LF-ABC123'})).text)
      .toBe('Redeemed for $10 off (code LF-ABC123)');
  });

  it('falls back when a redeem has no title', () => {
    expect(describePointsEvent(row('redeem', {})).text).toBe('Redeemed for a reward');
  });

  it('names the code of a used reward', () => {
    expect(describePointsEvent(row('reward_used', {code: 'LF-ABC123'})).text).toBe('Used reward code LF-ABC123');
    expect(describePointsEvent(row('reward_used')).text).toBe('Used a reward code');
  });

  it('names the rule of a manual award', () => {
    expect(describePointsEvent(row('manual', {title: 'Birthday'})).text).toBe('Awarded for Birthday');
    expect(describePointsEvent(row('manual')).text).toBe('Awarded points');
  });

  it('shows who adjusted and why', () => {
    expect(describePointsEvent(row('adjust', {staffName: 'Rina', reason: 'damaged parcel'})).text)
      .toBe('Adjusted by Rina: damaged parcel');
    expect(describePointsEvent(row('adjust', {})).text).toBe('Adjusted by staff');
  });

  it('has a fallback for unknown types', () => {
    expect(describePointsEvent(row('something_new')).text).toBe('Points changed');
  });

  it('returns the order number from the order GID', () => {
    expect(describePointsEvent(row('order', null, 'gid://shopify/Order/6209829119461')).orderNumber).toBe('6209829119461');
    expect(describePointsEvent(row('signup')).orderNumber).toBeNull();
    expect(describePointsEvent(row('order', null, 'not-a-gid')).orderNumber).toBeNull();
  });
});
