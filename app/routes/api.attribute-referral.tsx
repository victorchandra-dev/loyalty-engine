import type {ActionFunctionArgs} from 'react-router';
import type {AdminApiContext} from '@shopify/shopify-app-react-router/server';
import {
  attributeReferralForCustomer,
  ReferralAttributionError,
} from '../loyalty/customer-state.server';
import {authenticate, unauthenticated} from '../shopify.server';

const SHARED_SECRET_HEADER = 'x-loyalty-engine-secret';
const SHOP_DOMAIN_HEADER = 'x-shopify-shop-domain';

/**
 * Attribute a referral for a customer.
 *
 * Auth paths mirror /api/redeem:
 *  - Shared-secret: storefront-driven calls send `X-Loyalty-Engine-Secret`
 *    plus `X-Shopify-Shop-Domain`. The Hydrogen storefront verifies the
 *    customer is signed in via Customer Account API and resolves the
 *    customer's GID server-side before calling this endpoint.
 *  - Admin auth: ops/QA can hit it from the embedded admin too.
 *
 * POST /api/attribute-referral
 * body: { refereeId: string, referrerId: string }
 *
 * 200: { ok: true, attribution: ReferralAttribution }
 * 400: self-referral
 * 404: referee or referrer not found
 * 409: referee already attributed
 * 405: method not allowed
 */
export const action = async ({request}: ActionFunctionArgs) => {
  if (request.method !== 'POST') {
    return Response.json({error: 'Method not allowed'}, {status: 405});
  }

  let admin: AdminApiContext;
  try {
    admin = await resolveAdminContext(request);
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({error: error.message}, {status: error.status});
    }
    throw error;
  }

  let body: {refereeId?: unknown; referrerId?: unknown};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({error: 'Body must be JSON.'}, {status: 400});
  }

  const refereeId =
    typeof body.refereeId === 'string' && body.refereeId.trim()
      ? body.refereeId.trim()
      : null;
  const referrerId =
    typeof body.referrerId === 'string' && body.referrerId.trim()
      ? body.referrerId.trim()
      : null;

  if (!refereeId || !referrerId) {
    return Response.json(
      {error: 'refereeId and referrerId are required.'},
      {status: 400},
    );
  }

  try {
    const attribution = await attributeReferralForCustomer({
      admin,
      refereeId,
      referrerId,
    });
    return Response.json({ok: true, attribution});
  } catch (error) {
    if (error instanceof ReferralAttributionError) {
      return Response.json({error: error.message}, {status: error.status});
    }
    console.error('[loyalty] attributeReferralForCustomer failed', error);
    return Response.json({error: 'Failed to attribute referral.'}, {status: 500});
  }
};

export const loader = () => {
  return Response.json({error: 'Method not allowed'}, {status: 405});
};

class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'AuthError';
  }
}

async function resolveAdminContext(
  request: Request,
): Promise<AdminApiContext> {
  const providedSecret = request.headers.get(SHARED_SECRET_HEADER);
  const expectedSecret = process.env.LOYALTY_ENGINE_SHARED_SECRET ?? '';

  if (providedSecret && expectedSecret) {
    if (!constantTimeEquals(providedSecret, expectedSecret)) {
      throw new AuthError('Invalid loyalty engine secret.', 401);
    }
    const shopDomain = request.headers.get(SHOP_DOMAIN_HEADER);
    if (!shopDomain) {
      throw new AuthError(
        `${SHOP_DOMAIN_HEADER} header is required for shared-secret auth.`,
        400,
      );
    }
    const {admin} = await unauthenticated.admin(shopDomain);
    return admin;
  }

  const {admin} = await authenticate.admin(request);
  return admin;
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
