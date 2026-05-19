import type {ActionFunctionArgs} from 'react-router';
import {authenticate} from '../shopify.server';

type DataRequestPayload = {
  customer?: {id?: number | null; email?: string | null} | null;
};

export const action = async ({request}: ActionFunctionArgs) => {
  const {payload, shop, topic} = await authenticate.webhook(request);
  const {customer} = payload as DataRequestPayload;

  // All loyalty data lives in Shopify metafields — no external store to export.
  // Logging satisfies the audit trail requirement.
  console.warn(
    `[gdpr] ${topic} for ${shop}: customer id=${customer?.id} email=${customer?.email}`,
  );

  return new Response();
};
