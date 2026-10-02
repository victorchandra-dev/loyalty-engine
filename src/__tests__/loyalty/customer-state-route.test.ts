import {describe, it, expect, vi, beforeEach} from 'vitest';
import {customerResponse, fakeAdmin} from '../helpers/fakes.js';

const authenticateAdmin = vi.fn();
const unauthenticatedAdmin = vi.fn();
vi.mock('../../../app/shopify.server', () => ({
  authenticate: {admin: authenticateAdmin},
  unauthenticated: {admin: unauthenticatedAdmin},
}));

const {action} = await import('../../../app/routes/api.customer-state');

function post(headers: Record<string, string> = {}) {
  return action({
    request: new Request('https://engine.test/api/customer-state', {
      method: 'POST',
      headers: {'content-type': 'application/json', ...headers},
      body: JSON.stringify({customerAdminId: 'gid://shopify/Customer/1'}),
    }),
  } as never);
}

describe('POST /api/customer-state', () => {
  beforeEach(() => {
    process.env.LOYALTY_ENGINE_SHARED_SECRET = 'test-shared-secret';
  });

  it("returns the customer's points, live spend, orders and unused reward (storefront showed 0, 2 Oct)", async () => {
    const reward = {
      handle: 'discount-10', rewardType: 'fixed_discount', rewardValue: '10', pointsCost: 500,
      expiresAt: '2026-10-31T09:00:00Z', redemptionId: 'd10', redeemedAt: '2026-10-01T09:00:00Z',
      code: 'LF-ABC123', discountId: 'gid://shopify/DiscountCodeNode/77',
    };
    const shopify = fakeAdmin({LoyaltyCustomer: () => customerResponse({balance: 873, activeRedemption: reward})});
    authenticateAdmin.mockResolvedValueOnce({admin: shopify.admin, session: {shop: 'test.myshopify.com'}});

    const response = await post();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({pointsBalance: 873, lifetimeSpend: 250, paidOrderCount: 3, currencyCode: 'USD'});
    expect(JSON.parse(body.activeRedemption)).toMatchObject({code: 'LF-ABC123', expiresAt: '2026-10-31T09:00:00Z'});
  });

  it("refuses a storefront call that can't prove it acts for this customer", async () => {
    unauthenticatedAdmin.mockResolvedValueOnce({admin: fakeAdmin({}).admin});

    const response = await post({
      'x-loyalty-engine-secret': 'test-shared-secret',
      'x-shopify-shop-domain': 'test.myshopify.com',
    });

    expect(response.status).toBe(403);
  });
});
