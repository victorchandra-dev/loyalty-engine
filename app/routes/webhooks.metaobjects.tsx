import type {ActionFunctionArgs} from 'react-router';
import {isLoyaltyConfigMetaobject} from '../../src/webhooks/metaobjects.js';
import type {MetaobjectWebhookPayload} from '../../src/webhooks/metaobjects.js';
import {syncShopProgramSnapshot} from '../loyalty/program.server';
import {authenticate} from '../shopify.server';

export const action = async ({request}: ActionFunctionArgs) => {
  const {payload, shop, topic, session, admin} =
    await authenticate.webhook(request);

  console.warn(`Received ${topic} webhook for ${shop}`);

  if (!session || !admin) {
    return new Response();
  }

  if (!isLoyaltyConfigMetaobject(payload as MetaobjectWebhookPayload)) {
    return new Response();
  }

  try {
    await syncShopProgramSnapshot(admin);
  } catch (error) {
    console.error(`[loyalty] Failed to sync program snapshot for ${shop}`);
    console.error(error);
  }

  return new Response();
};
