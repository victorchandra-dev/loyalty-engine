import {describe, it, expect, vi} from 'vitest';
import {fakeAdmin, okWrite} from '../helpers/fakes.js';

vi.mock('../../../app/session-storage.server', () => ({prisma: {}}));

const {attributeReferralForCustomer, ReferralAttributionError} = await import(
  '../../../app/loyalty/customer-state.server'
);

const REFEREE = 'gid://shopify/Customer/2';
const REFERRER = 'gid://shopify/Customer/1';

function shop(numberOfOrders: number | string, referredBy: string | null = null) {
  return fakeAdmin({
    LoyaltyCustomerReferralAttribution: () => ({
      referee: {id: REFEREE, numberOfOrders, referredBy: referredBy ? {value: referredBy} : null},
      referrer: {id: REFERRER},
    }),
    LoyaltyMetafieldsSet: okWrite,
  });
}

const attribute = (admin: unknown) =>
  attributeReferralForCustomer({admin: admin as never, refereeId: REFEREE, referrerId: REFERRER});

describe('attributeReferralForCustomer', () => {
  it('attributes a customer with no orders yet', async () => {
    const shopify = shop('0');
    const attribution = await attribute(shopify.admin);
    expect(attribution.referrerCustomerId).toBe(REFERRER);
    expect(shopify.writes()).toHaveLength(1);
  });

  it('refuses a customer who has already ordered (409), writing nothing', async () => {
    const shopify = shop('3');
    const error = await attribute(shopify.admin).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ReferralAttributionError);
    expect((error as {status: number}).status).toBe(409);
    expect(shopify.writes()).toHaveLength(0);
  });

  it('refuses a customer who is already attributed (409)', async () => {
    const shopify = shop(0, '{"referrerCustomerId":"gid://shopify/Customer/9"}');
    const error = await attribute(shopify.admin).catch((caught: unknown) => caught);
    expect((error as {status: number}).status).toBe(409);
    expect(shopify.writes()).toHaveLength(0);
  });
});
