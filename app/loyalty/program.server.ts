import type {AdminApiContext} from '@shopify/shopify-app-react-router/server';
import {
  LOYALTY_PROGRAM_ADMIN_QUERY,
  METAFIELDS_SET_MUTATION,
} from '../../src/integrations/shopify/admin-operations.js';
import {toMerchantMetaobjectEntry} from '../../src/integrations/shopify/metaobjects.js';
import {buildMetaobjectSyncPlan} from '../../src/webhooks/metaobjects.js';
import type {ShopifyMetaobjectNode} from '../../src/integrations/shopify/metaobjects.js';
import {
  APP_METAFIELD_NAMESPACE,
  SHOP_LOYALTY_PROGRAM_ISSUES_KEY,
  SHOP_LOYALTY_PROGRAM_SNAPSHOT_KEY,
  SHOP_LOYALTY_PROGRAM_SYNCED_AT_KEY,
} from './constants';
import {adminGraphql, assertNoUserErrors} from './graphql.server';
import {ensureCustomerLoyaltyStateDefinition} from './customer-state.server';

export type LoyaltyMetaobjectDefinition = {
  id: string;
  name: string;
  type: string;
  displayNameKey: string | null;
  access: {
    admin: string | null;
    storefront: string | null;
  } | null;
  fieldDefinitions: Array<{
    key: string;
    name: string;
    type: {
      name: string;
    };
  }>;
};

type LoyaltyProgramAdminQueryData = {
  shop: {
    id: string;
    currencyCode: string;
    discountId: {
      value: string;
    } | null;
  };
  tierDefinition: LoyaltyMetaobjectDefinition | null;
  benefitDefinition: LoyaltyMetaobjectDefinition | null;
  tierDefinitions: {
    nodes: ShopifyMetaobjectNode[];
  };
  benefitDefinitions: {
    nodes: ShopifyMetaobjectNode[];
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

export type LoyaltyProgramConfiguration = Awaited<
  ReturnType<typeof fetchLoyaltyProgramConfiguration>
>;

export async function fetchLoyaltyProgramConfiguration(admin: AdminApiContext) {
  const data = await adminGraphql<LoyaltyProgramAdminQueryData>(
    admin,
    LOYALTY_PROGRAM_ADMIN_QUERY,
  );

  const tierEntries = data.tierDefinitions.nodes.map(toMerchantMetaobjectEntry);
  const benefitEntries = data.benefitDefinitions.nodes.map(
    toMerchantMetaobjectEntry,
  );
  const syncPlan = buildMetaobjectSyncPlan({
    currencyCode: data.shop.currencyCode,
    tierEntries,
    benefitEntries,
  });

  return {
    shopId: data.shop.id,
    currencyCode: data.shop.currencyCode,
    currentDiscountId: data.shop.discountId?.value ?? null,
    tierDefinition: data.tierDefinition,
    benefitDefinition: data.benefitDefinition,
    tierEntries,
    benefitEntries,
    syncPlan,
  };
}

export async function syncShopProgramSnapshot(admin: AdminApiContext) {
  const configuration = await fetchLoyaltyProgramConfiguration(admin);

  await ensureCustomerLoyaltyStateDefinition(admin);

  const result = await adminGraphql<MetafieldsSetMutationData>(
    admin,
    METAFIELDS_SET_MUTATION,
    {
      metafields: [
        {
          ownerId: configuration.shopId,
          namespace: APP_METAFIELD_NAMESPACE,
          key: SHOP_LOYALTY_PROGRAM_SNAPSHOT_KEY,
          type: 'json',
          value: JSON.stringify({
            program: configuration.syncPlan.program,
            discountConfiguration: configuration.syncPlan.discountConfiguration,
          }),
        },
        {
          ownerId: configuration.shopId,
          namespace: APP_METAFIELD_NAMESPACE,
          key: SHOP_LOYALTY_PROGRAM_ISSUES_KEY,
          type: 'json',
          value: JSON.stringify(configuration.syncPlan.issues),
        },
        {
          ownerId: configuration.shopId,
          namespace: APP_METAFIELD_NAMESPACE,
          key: SHOP_LOYALTY_PROGRAM_SYNCED_AT_KEY,
          type: 'date_time',
          value: new Date().toISOString(),
        },
      ],
    },
  );

  assertNoUserErrors(
    result.metafieldsSet.userErrors,
    'Failed to sync loyalty program snapshot',
  );

  return configuration;
}
