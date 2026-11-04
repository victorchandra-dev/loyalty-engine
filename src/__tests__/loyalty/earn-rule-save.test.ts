import {describe, it, expect, vi} from 'vitest';
import {fakeAdmin} from '../helpers/fakes.js';

vi.mock('../../../app/session-storage.server', () => ({prisma: {}}));

const {saveEarnRuleConfiguration} = await import(
  '../../../app/loyalty/earn-rules-redemptions-admin.server'
);

const rule = (action: string, pointsValue: number | null) => ({
  title: action,
  description: '',
  action,
  pointsValue,
  active: true,
  repeatable: false,
});

describe('saveEarnRuleConfiguration points check', () => {
  it.each([
    ['signup', null],
    ['referral', 0],
  ])('refuses a %s rule with points %s, before touching Shopify', async (action, points) => {
    const shopify = fakeAdmin({});
    await expect(
      saveEarnRuleConfiguration({admin: shopify.admin as never, earnRules: [rule(action, points)]}),
    ).rejects.toThrow('needs a points value above 0');
    expect(shopify.calls).toHaveLength(0);
  });

  it('still lets an order rule be blank (1 point per $1)', async () => {
    const shopify = fakeAdmin({});
    // Passes the check and goes on to read the program; the fake has no responder for that.
    await expect(
      saveEarnRuleConfiguration({admin: shopify.admin as never, earnRules: [rule('order', null)]}),
    ).rejects.toThrow('fakeAdmin: no responder');
  });
});
