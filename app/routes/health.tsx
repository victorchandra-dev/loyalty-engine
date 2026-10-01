import type {LoaderFunctionArgs} from 'react-router';
import {prisma} from '../session-storage.server';

export const loader = async ({request}: LoaderFunctionArgs) => {
  if (request.method !== 'GET') {
    return Response.json({error: 'Method not allowed'}, {status: 405});
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ok: true, db: 'up'});
  } catch (error) {
    console.error('[health] DB check failed', error);
    return Response.json({ok: false, db: 'down'}, {status: 503});
  }
};
