import type {ActionFunctionArgs} from 'react-router';
import type {AdminApiContext} from '@shopify/shopify-app-react-router/server';
import {
  attributeReferralForCustomer,
  ReferralAttributionError,
} from '../loyalty/customer-state.server';
import {
  AuthError,
  resolveAdminContext,
  verifyCustomerToken,
} from '../loyalty/engine-auth.server';

// ponytail: no rate limit here, same reason as api.redeem.tsx.

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
  let authPath: 'shared-secret' | 'admin';
  try {
    ({admin, authPath} = await resolveAdminContext(request));
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

  // Per-customer authorization: the token must authorize the REFEREE (the
  // customer being attributed). referrerId stays untrusted and is validated
  // downstream. Admin (embedded) calls are exempt.
  if (authPath === 'shared-secret') {
    try {
      verifyCustomerToken({request, subjectId: refereeId});
    } catch (error) {
      if (error instanceof AuthError) {
        return Response.json({error: error.message}, {status: error.status});
      }
      throw error;
    }
  }

  // Reject self-referral engine-side too, so the guard does not depend solely
  // on attributeReferralForCustomer's own check.
  if (refereeId === referrerId) {
    return Response.json(
      {error: 'A customer cannot refer themselves.'},
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
