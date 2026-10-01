import {describe, it, expect, vi} from 'vitest';
import {customerResponse, fakeAdmin, field, okWrite, snapshotResponse} from '../helpers/fakes.js';

// Admin (embedded) auth path: no shared-secret header, so no customer token.
const authenticateAdmin = vi.fn();
vi.mock('../../../app/shopify.server', () => ({
  authenticate: {admin: authenticateAdmin},
  unauthenticated: {admin: vi.fn()},
}));

const {action} = await import('../../../app/routes/api.redeem');

function redeem(admin: unknown) {
  authenticateAdmin.mockResolvedValueOnce({admin});
  return action({
    request: new Request('https://engine.test/api/redeem', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({customerAdminId: 'gid://shopify/Customer/1', redemptionHandle: 'discount-10'}),
    }),
  } as never);
}

describe('POST /api/redeem', () => {
  it('debits the points and stores the reward in one guarded write', async () => {
    const shopify = fakeAdmin({
      LoyaltyProgramSnapshot: snapshotResponse(),
      LoyaltyCustomer: () => customerResponse({balance: 600, digest: 'd1'}),
      LoyaltyMetafieldsSet: okWrite,
    });

    const response = await redeem(shopify.admin);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ok: true, newBalance: 100, redemption: {handle: 'discount-10'}});
    const [write] = shopify.writes();
    expect(field(write, 'loyalty_points_balance')).toMatchObject({value: '100', compareDigest: 'd1'});
    expect(JSON.parse(field(write, 'loyalty_active_redemption')?.value as string)).toMatchObject({handle: 'discount-10', pointsCost: 500});
  });

  it('refuses a second reward while one is waiting, without taking points (bug 8)', async () => {
    const shopify = fakeAdmin({
      LoyaltyProgramSnapshot: snapshotResponse(),
      LoyaltyCustomer: () =>
        customerResponse({
          balance: 600,
          activeRedemption: {
            handle: 'discount-10', rewardType: 'fixed_discount', rewardValue: '10', pointsCost: 500,
            expiresAt: new Date(Date.now() + 3_600_000).toISOString(), redemptionId: 'd10', redeemedAt: new Date().toISOString(),
          },
        }),
      LoyaltyMetafieldsSet: okWrite,
    });

    const response = await redeem(shopify.admin);

    expect(response.status).toBe(409);
    expect(shopify.writes()).toHaveLength(0);
  });
});
