import {describe, it, expect, vi} from 'vitest';

import {ensureCustomerLoyaltyStateDefinition} from '../../../app/loyalty/customer-state.server';
import {
  CUSTOMER_LOYALTY_STATE_KEY,
  CUSTOMER_LOYALTY_POINTS_BALANCE_KEY,
  CUSTOMER_LOYALTY_ACTIVE_REDEMPTION_KEY,
} from '../../../app/loyalty/constants';

/**
 * BUG SYNTH-1: customer sees 0 points / 0 XP in the customer-account extension.
 *
 * The customer-account extension reads THREE Customer metafields via the
 * Customer Account API (extensions/loyalty-customer-account/src/shared.js):
 *   - loyalty_state
 *   - loyalty_points_balance
 *   - loyalty_active_redemption
 *
 * The Customer Account API only returns a metafield whose definition grants
 * customerAccount READ access. Without that definition, the API returns null,
 * so the storefront renders 0 points / 0 XP.
 *
 * This test asserts the desired behaviour: the bootstrap that ensures Customer
 * metafield definitions must grant customerAccount READ for ALL THREE keys.
 */

type CapturedCall = {query: string; variables: Record<string, unknown>};

function makeFakeAdmin() {
  const calls: CapturedCall[] = [];

  const graphql = vi.fn(async (query: string, opts?: {variables?: Record<string, unknown>}) => {
    const variables = opts?.variables ?? {};
    calls.push({query, variables});

    // BY_KEY query -> report no existing definition so the create path runs.
    if (query.includes('metafieldDefinitions(')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({data: {metafieldDefinitions: {nodes: []}}}),
      };
    }

    if (query.includes('metafieldDefinitionCreate')) {
      const def = (variables.definition ?? {}) as {key?: string};
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            metafieldDefinitionCreate: {
              createdDefinition: {
                id: `gid://shopify/MetafieldDefinition/${def.key}`,
                namespace: '$app',
                key: def.key,
              },
              userErrors: [],
            },
          },
        }),
      };
    }

    if (query.includes('metafieldDefinitionUpdate')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            metafieldDefinitionUpdate: {
              updatedDefinition: {id: 'gid://shopify/MetafieldDefinition/1'},
              userErrors: [],
            },
          },
        }),
      };
    }

    throw new Error(`Unexpected GraphQL query in test: ${query}`);
  });

  return {admin: {graphql} as any, calls};
}

/**
 * Collect the set of Customer metafield keys for which the bootstrap issued a
 * create or update mutation granting customerAccount READ access.
 */
function keysGrantedCustomerAccountRead(calls: CapturedCall[]): Set<string> {
  const granted = new Set<string>();
  for (const call of calls) {
    const isCreate = call.query.includes('metafieldDefinitionCreate');
    const isUpdate = call.query.includes('metafieldDefinitionUpdate');
    if (!isCreate && !isUpdate) continue;

    const def = (call.variables.definition ?? {}) as {
      key?: string;
      access?: {customerAccount?: string};
    };
    if (def.key && def.access?.customerAccount === 'READ') {
      granted.add(def.key);
    }
  }
  return granted;
}

describe('SYNTH-1: customer-account metafield READ access', () => {
  it('grants customerAccount READ to all three metafields the extension reads (else customer sees 0 points / 0 XP)', async () => {
    const {admin, calls} = makeFakeAdmin();

    await ensureCustomerLoyaltyStateDefinition(admin);

    const granted = keysGrantedCustomerAccountRead(calls);

    expect(granted.has(CUSTOMER_LOYALTY_STATE_KEY)).toBe(true);
    expect(granted.has(CUSTOMER_LOYALTY_POINTS_BALANCE_KEY)).toBe(true);
    expect(granted.has(CUSTOMER_LOYALTY_ACTIVE_REDEMPTION_KEY)).toBe(true);
  });
});
