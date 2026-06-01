import * as Sentry from '@sentry/node';
import type {AdminApiContext} from '@shopify/shopify-app-react-router/server';
import {adminGraphql} from './graphql.server';

/**
 * Active billing plan for the current shop, derived from Shopify Managed
 * Pricing. During the 14-day trial Shopify reports the subscription as ACTIVE,
 * so trial merchants resolve to isPro=true with no extra trial handling.
 */
export type ActivePlan = {isPro: boolean; planName: string | null};

type ActiveSubscriptionsData = {
  currentAppInstallation: {
    activeSubscriptions: Array<{name: string; status: string}>;
  };
};

const ACTIVE_SUBSCRIPTIONS_QUERY = `#graphql
  query ActiveSubscriptions {
    currentAppInstallation {
      activeSubscriptions {
        name
        status
      }
    }
  }
`;

/**
 * Resolve the shop's active plan. Fails OPEN to Free on any error: a billing
 * lookup outage must never block a merchant from using already-saved config
 * (reads are ungated) nor silently grant Pro. The only effect of fail-open is a
 * paying merchant briefly cannot add a 4th+ tier during an outage.
 */
export async function getActivePlan(admin: AdminApiContext): Promise<ActivePlan> {
  try {
    const data = await adminGraphql<ActiveSubscriptionsData>(
      admin,
      ACTIVE_SUBSCRIPTIONS_QUERY,
    );
    const active = data.currentAppInstallation.activeSubscriptions.find(
      (sub) => sub.status === 'ACTIVE',
    );
    return active
      ? {isPro: true, planName: active.name}
      : {isPro: false, planName: null};
  } catch (error) {
    Sentry.captureException(error);
    return {isPro: false, planName: null};
  }
}

/**
 * URL of the Shopify-hosted Managed Pricing page for the Upgrade CTA. `handle`
 * is the app handle from the Partner Dashboard (see SHOPIFY_APP_HANDLE env).
 */
export function managedPricingUrl(
  shopDomain: string | null,
  handle: string,
): string {
  const path = `charges/${handle}/pricing_plans`;
  if (!shopDomain) {
    return `https://admin.shopify.com/${path}`;
  }
  const store = shopDomain.replace(/\.myshopify\.com$/, '');
  return `https://admin.shopify.com/store/${store}/${path}`;
}
