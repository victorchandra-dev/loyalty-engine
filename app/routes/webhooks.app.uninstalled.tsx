import type {ActionFunctionArgs} from 'react-router';
import {authenticate, sessionStorage} from '../shopify.server';

export const action = async ({request}: ActionFunctionArgs) => {
  const {shop, topic} = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // Delete every session for the shop so offline and online tokens are cleared together.
  const sessions = await sessionStorage.findSessionsByShop(shop);
  if (sessions.length > 0) {
    await sessionStorage.deleteSessions(sessions.map((storedSession) => storedSession.id));
  }

  return new Response();
};
