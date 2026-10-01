import {vi} from 'vitest';
import type {LoyaltyProgramConfig} from '../../domain/program.js';

/**
 * In-memory ProcessedWebhook table with Prisma's duplicate-key error, and a
 * PointsEvent table (`events`) that tests can make fail with
 * `pointsEvent.createMany.mockRejectedValueOnce`.
 */
export function memoryPrisma() {
  const keys = new Set<string>();
  const events: Array<Record<string, unknown>> = [];
  return {
    keys,
    events,
    pointsEvent: {
      createMany: vi.fn(async ({data}: {data: Array<Record<string, unknown>>}) => {
        events.push(...data);
        return {count: data.length};
      }),
    },
    processedWebhook: {
      create: vi.fn(async ({data}: {data: {key: string}}) => {
        if (keys.has(data.key)) {
          throw Object.assign(new Error('Unique constraint failed'), {code: 'P2002'});
        }
        keys.add(data.key);
      }),
      delete: vi.fn(async ({where}: {where: {key: string}}) => {
        keys.delete(where.key);
      }),
    },
  };
}

type Responder = (variables: Record<string, unknown>) => unknown;

/**
 * Fake Shopify Admin client. Routes each call by its GraphQL operation name to
 * a responder that returns the `data` object (or throws to simulate a failed
 * request), and records every call for assertions.
 */
export function fakeAdmin(responders: Record<string, Responder>) {
  const calls: Array<{name: string; variables: Record<string, unknown>}> = [];
  const graphql = vi.fn(
    async (query: string, options?: {variables?: Record<string, unknown>}) => {
      const name = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? 'unknown';
      const variables = options?.variables ?? {};
      calls.push({name, variables});
      const responder = responders[name];
      if (!responder) throw new Error(`fakeAdmin: no responder for ${name}`);
      const data = responder(variables);
      return {ok: true, status: 200, json: async () => ({data})};
    },
  );
  return {
    admin: {graphql},
    calls,
    /** The metafields of every metafieldsSet call, in order. */
    writes: () =>
      calls
        .filter((call) => call.name === 'LoyaltyMetafieldsSet')
        .map((call) => call.variables.metafields as Array<Record<string, unknown>>),
  };
}

export const okWrite = () => ({metafieldsSet: {metafields: [], userErrors: []}});

export const testProgram: LoyaltyProgramConfig = {
  currencyCode: 'USD',
  tiers: [],
  benefits: [],
  earnRules: [
    {id: 'o', handle: 'order', title: 'Order', description: null, action: 'order', pointsValue: null, active: true, repeatable: true},
    {id: 's', handle: 'signup', title: 'Signup', description: null, action: 'signup', pointsValue: 200, active: true, repeatable: false},
    {id: 'r', handle: 'referral', title: 'Referral', description: null, action: 'referral', pointsValue: 500, active: true, repeatable: false},
  ],
  redemptions: [
    {id: 'd10', handle: 'discount-10', title: '$10 off', description: null, pointsCost: 500, rewardType: 'fixed_discount', rewardValue: '10', active: true},
  ],
};

export const snapshotResponse = (program: LoyaltyProgramConfig | null = testProgram, enabled = true) => () => ({
  shop: {snapshot: {value: JSON.stringify({enabled, program})}},
});

/** A LoyaltyCustomer query response for one customer. */
export function customerResponse({
  id = 'gid://shopify/Customer/1',
  balance = 0,
  digest = 'digest-1',
  awardedRules = ['signup'],
  activeRedemption = null as unknown,
  referrerId = null as string | null,
  referralCredited = false,
} = {}) {
  return {
    customer: {
      id,
      amountSpent: {amount: '250.00', currencyCode: 'USD'},
      numberOfOrders: 3,
      balance: {value: String(balance), compareDigest: digest},
      state: {value: JSON.stringify({awardedRules})},
      activeRedemption: activeRedemption ? {value: JSON.stringify(activeRedemption)} : null,
      referredBy: referrerId
        ? {value: JSON.stringify({referrerCustomerId: referrerId, attributedAt: '2026-09-01T00:00:00Z'})}
        : null,
      referredByCredited: referralCredited ? {value: 'true'} : null,
    },
  };
}

/** Find one metafield in a write by key (and optionally owner). */
export function field(
  metafields: Array<Record<string, unknown>>,
  key: string,
  ownerId?: string,
) {
  return metafields.find(
    (entry) => entry.key === key && (!ownerId || entry.ownerId === ownerId),
  );
}
