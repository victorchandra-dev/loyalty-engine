import type {ActionFunctionArgs} from 'react-router';
import {authenticate, sessionStorage} from '../shopify.server';

export const action = async ({request}: ActionFunctionArgs) => {
  const {shop, topic} = await authenticate.webhook(request);

  console.warn(`[gdpr] ${topic} for ${shop}`);

  // Delete all Prisma sessions for this shop — the only engine-owned storage
  // outside Shopify. Mirrors webhooks.app.uninstalled (the deferred version).
  try {
    const sessions = await sessionStorage.findSessionsByShop(shop);
    if (sessions.length > 0) {
      await sessionStorage.deleteSessions(
        sessions.map((s) => s.id),
      );
      console.warn(`[gdpr] Deleted ${sessions.length} session(s) for ${shop}`);
    }
  } catch (error) {
    console.error('[gdpr] shop/redact session cleanup failed', error);
  }

  return new Response();
};
