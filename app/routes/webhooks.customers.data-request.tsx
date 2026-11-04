import type {ActionFunctionArgs} from 'react-router';
import {authenticate} from '../shopify.server';

type DataRequestPayload = {
  customer?: {id?: number | null; email?: string | null} | null;
};

export const action = async ({request}: ActionFunctionArgs) => {
  const {payload, shop, topic} = await authenticate.webhook(request);
  const {customer} = payload as DataRequestPayload;

  // Loyalty data lives in Shopify metafields plus the engine's PointsEvent
  // table (points history). Shopify expects the merchant to send the data, so
  // log the request; the merchant can read the history on the customer page.
  console.warn(
    `[gdpr] ${topic} for ${shop}: customer id=${customer?.id} email=${customer?.email}`,
  );

  return new Response();
};
