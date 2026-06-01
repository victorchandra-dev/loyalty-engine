import {describe, it, expect} from 'vitest';
import {getActivePlan, managedPricingUrl} from '../../../app/loyalty/billing.server.js';

// Minimal fake AdminApiContext: only `.graphql` is used by getActivePlan.
function fakeAdmin(activeSubscriptions: Array<{name: string; status: string}>) {
  return {
    graphql: async () => ({
      ok: true,
      json: async () => ({
        data: {currentAppInstallation: {activeSubscriptions}},
      }),
    }),
  } as never;
}

function throwingAdmin() {
  return {
    graphql: async () => {
      throw new Error('network down');
    },
  } as never;
}

describe('getActivePlan', () => {
  it('is Pro when an ACTIVE subscription exists', async () => {
    const plan = await getActivePlan(fakeAdmin([{name: 'Pro', status: 'ACTIVE'}]));
    expect(plan).toEqual({isPro: true, planName: 'Pro'});
  });

  it('is Free when there are no active subscriptions', async () => {
    const plan = await getActivePlan(fakeAdmin([]));
    expect(plan).toEqual({isPro: false, planName: null});
  });

  it('ignores non-ACTIVE subscriptions', async () => {
    const plan = await getActivePlan(fakeAdmin([{name: 'Pro', status: 'CANCELLED'}]));
    expect(plan.isPro).toBe(false);
  });

  it('fails open to Free when the query throws', async () => {
    const plan = await getActivePlan(throwingAdmin());
    expect(plan).toEqual({isPro: false, planName: null});
  });
});

describe('managedPricingUrl', () => {
  it('builds the admin pricing-plans path from shop + handle', () => {
    const url = managedPricingUrl('demo-store.myshopify.com', 'ama-da-flow-loyalty');
    expect(url).toBe(
      'https://admin.shopify.com/store/demo-store/charges/ama-da-flow-loyalty/pricing_plans',
    );
  });

  it('handles a null shop domain by returning the generic charges path', () => {
    const url = managedPricingUrl(null, 'ama-da-flow-loyalty');
    expect(url).toBe(
      'https://admin.shopify.com/charges/ama-da-flow-loyalty/pricing_plans',
    );
  });
});
