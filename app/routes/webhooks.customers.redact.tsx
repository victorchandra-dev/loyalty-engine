import type {ActionFunctionArgs} from 'react-router';
import {
  APP_METAFIELD_NAMESPACE,
  CUSTOMER_LOYALTY_STATE_KEY,
  CUSTOMER_LOYALTY_POINTS_BALANCE_KEY,
  CUSTOMER_LOYALTY_ACTIVE_REDEMPTION_KEY,
  CUSTOMER_LOYALTY_REFERRED_BY_KEY,
  CUSTOMER_LOYALTY_REFERRED_BY_CREDITED_KEY,
} from '../loyalty/constants';
import {adminGraphql} from '../loyalty/graphql.server';
import {authenticate} from '../shopify.server';

const CUSTOMER_LOYALTY_KEYS = [
  CUSTOMER_LOYALTY_STATE_KEY,
  CUSTOMER_LOYALTY_POINTS_BALANCE_KEY,
  CUSTOMER_LOYALTY_ACTIVE_REDEMPTION_KEY,
  CUSTOMER_LOYALTY_REFERRED_BY_KEY,
  CUSTOMER_LOYALTY_REFERRED_BY_CREDITED_KEY,
];

const METAFIELDS_DELETE_MUTATION = `#graphql
  mutation LoyaltyMetafieldsDelete($metafields: [MetafieldIdentifierInput!]!) {
    metafieldsDelete(metafields: $metafields) {
      deletedMetafields {
        key
      }
      userErrors {
        field
        message
      }
    }
  }
` as const;

type MetafieldsDeleteData = {
  metafieldsDelete: {
    deletedMetafields: Array<{key: string}>;
    userErrors: Array<{field?: string | null; message: string}>;
  };
};

type RedactPayload = {
  customer?: {id?: number | null} | null;
  admin_graphql_api_customer_id?: string | null;
};

export const action = async ({request}: ActionFunctionArgs) => {
  const {payload, shop, topic, session, admin} =
    await authenticate.webhook(request);

  console.warn(`[gdpr] ${topic} for ${shop}`);

  if (!session || !admin) {
    return new Response();
  }

  const p = payload as RedactPayload;
  const customerGid =
    p.admin_graphql_api_customer_id ??
    (p.customer?.id ? `gid://shopify/Customer/${p.customer.id}` : null);

  if (!customerGid) {
    return new Response();
  }

  try {
    const result = await adminGraphql<MetafieldsDeleteData>(
      admin,
      METAFIELDS_DELETE_MUTATION,
      {
        metafields: CUSTOMER_LOYALTY_KEYS.map((key) => ({
          ownerId: customerGid,
          namespace: APP_METAFIELD_NAMESPACE,
          key,
        })),
      },
    );

    const deleted = result.metafieldsDelete.deletedMetafields.map((m) => m.key);
    const errors = result.metafieldsDelete.userErrors;

    if (errors.length > 0) {
      console.error('[gdpr] customers/redact userErrors', errors);
    } else {
      console.warn(`[gdpr] Deleted metafields for ${customerGid}:`, deleted);
    }
  } catch (error) {
    console.error('[gdpr] customers/redact failed', error);
  }

  return new Response();
};
