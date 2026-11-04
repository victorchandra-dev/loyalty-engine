import type {ActionFunctionArgs} from 'react-router';
import {prisma} from '../session-storage.server';
import {authenticate, sessionStorage} from '../shopify.server';

export const action = async ({request}: ActionFunctionArgs) => {
  const {shop, topic} = await authenticate.webhook(request);

  console.warn(`[gdpr] ${topic} for ${shop}`);

  // Delete everything the engine stores for this shop outside Shopify: its
  // points history and its sessions. Failure returns 500 so Shopify retries.
  try {
    const {count} = await prisma.pointsEvent.deleteMany({where: {shop}});
    const sessions = await sessionStorage.findSessionsByShop(shop);
    if (sessions.length > 0) {
      await sessionStorage.deleteSessions(sessions.map((s) => s.id));
    }
    console.warn(`[gdpr] Deleted ${count} points history row(s) and ${sessions.length} session(s) for ${shop}`);
  } catch (error) {
    console.error('[gdpr] shop/redact cleanup failed', error);
    return new Response(null, {status: 500});
  }

  return new Response();
};
