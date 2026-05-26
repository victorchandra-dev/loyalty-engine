import {describe, it, expect, vi, beforeEach} from 'vitest';

/**
 * BUG C1 / IDOR: app/routes/api.redeem.tsx
 *
 * resolveAdminContext validates only a shop-wide shared secret
 * (x-loyalty-engine-secret) plus presence of x-shopify-shop-domain, then
 * trusts body.customerAdminId verbatim. There is NO per-customer binding, so
 * anyone holding the shared secret can move points for ANY customer.
 *
 * This test asserts the DESIRED secure behaviour: a request that carries a
 * valid shared secret but a per-customer authorization token
 * (x-loyalty-customer-token) that does NOT authorize the supplied
 * customerAdminId (here: absent) MUST be rejected with 401/403 and MUST NOT
 * apply a redemption.
 *
 * On HEAD there is no such check, so the request is processed (200) and the
 * redemption IS applied → this test FAILS.
 */

const applyRedemptionForCustomer = vi.fn(async () => ({
  newBalance: 123,
  redemption: {handle: 'free-shipping'},
}));

class RedemptionError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const fetchLoyaltyProgramConfiguration = vi.fn(async () => ({
  syncPlan: {program: {id: 'program-1', currencyCode: 'USD'}},
}));

const fakeAdmin = {graphql: vi.fn()};
const unauthenticatedAdmin = vi.fn(async () => ({admin: fakeAdmin}));
const authenticateAdmin = vi.fn(async () => ({admin: fakeAdmin}));

vi.mock('../../../app/loyalty/customer-state.server', () => ({
  applyRedemptionForCustomer,
  RedemptionError,
}));

vi.mock('../../../app/loyalty/program.server', () => ({
  fetchLoyaltyProgramConfiguration,
}));

vi.mock('../../../app/shopify.server', () => ({
  unauthenticated: {admin: unauthenticatedAdmin},
  authenticate: {admin: authenticateAdmin},
}));

const SHARED_SECRET = 'test-shared-secret';

function buildRequest(body: Record<string, unknown>, headers: Record<string, string>) {
  return new Request('https://engine.test/api/redeem', {
    method: 'POST',
    headers: {'content-type': 'application/json', ...headers},
    body: JSON.stringify(body),
  });
}

describe('C1 / IDOR: api.redeem per-customer authorization', () => {
  beforeEach(() => {
    process.env.LOYALTY_ENGINE_SHARED_SECRET = SHARED_SECRET;
    applyRedemptionForCustomer.mockClear();
  });

  it('rejects a shared-secret request that lacks per-customer authorization for the supplied customerAdminId (does not move points for arbitrary customers)', async () => {
    const {action} = await import('../../../app/routes/api.redeem');

    // Valid shop-wide secret + shop domain, but NO per-customer token
    // authorizing the supplied customerAdminId — i.e. the IDOR attack shape.
    const request = buildRequest(
      {
        customerAdminId: 'gid://shopify/Customer/999999',
        redemptionHandle: 'free-shipping',
      },
      {
        'x-loyalty-engine-secret': SHARED_SECRET,
        'x-shopify-shop-domain': 'adf-internal.myshopify.com',
        // no 'x-loyalty-customer-token'
      },
    );

    const response = await action({request} as any);

    expect([401, 403]).toContain(response.status);
    expect(applyRedemptionForCustomer).not.toHaveBeenCalled();
  });
});
