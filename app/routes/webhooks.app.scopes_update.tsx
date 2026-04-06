import type {ActionFunctionArgs} from 'react-router';
import {authenticate, sessionStorage} from '../shopify.server';

export const action = async ({request}: ActionFunctionArgs) => {
  const {payload, session, topic, shop} = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const current = payload.current as string[];
  if (session) {
    const storedSession = await sessionStorage.loadSession(session.id);

    if (storedSession) {
      storedSession.scope = current.toString();
      await sessionStorage.storeSession(storedSession);
    }
  }
  return new Response();
};
