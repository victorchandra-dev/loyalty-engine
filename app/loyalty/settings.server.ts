import type {AdminApiContext} from '@shopify/shopify-app-react-router/server';
import {METAFIELDS_SET_MUTATION} from '../../src/integrations/shopify/admin-operations.js';
import {
  APP_METAFIELD_NAMESPACE,
  SHOP_LOYALTY_PROGRAM_ENABLED_KEY,
} from './constants';
import {adminGraphql, assertNoUserErrors} from './graphql.server';

const PROGRAM_ENABLED_QUERY = `#graphql
  query LoyaltyProgramEnabled {
    shop {
      id
      programEnabled: metafield(
        namespace: "$app"
        key: "loyalty_program_enabled"
      ) {
        value
      }
    }
  }
` as const;

type ProgramEnabledData = {
  shop: {
    id: string;
    programEnabled: {value: string | null} | null;
  };
};

type MetafieldsSetMutationData = {
  metafieldsSet: {
    userErrors: Array<{
      field?: Array<string | number> | null;
      message: string;
    }>;
  };
};

/**
 * Read the program-enabled flag. The metafield holds the literal string
 * "true" or "false". Default to enabled (`true`) when the metafield is unset
 * — that's the legacy behaviour for shops that pre-date this toggle.
 */
export async function fetchProgramEnabled(
  admin: AdminApiContext,
): Promise<{shopId: string; enabled: boolean}> {
  const data = await adminGraphql<ProgramEnabledData>(
    admin,
    PROGRAM_ENABLED_QUERY,
  );
  const raw = data.shop.programEnabled?.value;
  return {
    shopId: data.shop.id,
    enabled: raw === null || raw === undefined ? true : raw !== 'false',
  };
}

export async function setProgramEnabled(
  admin: AdminApiContext,
  shopId: string,
  enabled: boolean,
): Promise<void> {
  const result = await adminGraphql<MetafieldsSetMutationData>(
    admin,
    METAFIELDS_SET_MUTATION,
    {
      metafields: [
        {
          ownerId: shopId,
          namespace: APP_METAFIELD_NAMESPACE,
          key: SHOP_LOYALTY_PROGRAM_ENABLED_KEY,
          type: 'boolean',
          value: enabled ? 'true' : 'false',
        },
      ],
    },
  );

  assertNoUserErrors(
    result.metafieldsSet.userErrors,
    'Failed to update program-enabled flag',
  );
}
