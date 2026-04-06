import type {ActionFunctionArgs} from 'react-router';
import {isLoyaltyConfigMetaobject} from '../../src/webhooks/metaobjects.js';
import type {MetaobjectWebhookPayload} from '../../src/webhooks/metaobjects.js';
import {syncShopProgramSnapshot} from '../loyalty/program.server';
import {authenticate} from '../shopify.server';

export const action = async ({request}: ActionFunctionArgs) => {
  const {payload, shop, topic, session, admin} =
    await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  if (!session || !admin) {
    return new Response();
  }

  if (!isLoyaltyConfigMetaobject(payload as MetaobjectWebhookPayload)) {
    return new Response();
  }

  await syncShopProgramSnapshot(admin);

  return new Response();
};
