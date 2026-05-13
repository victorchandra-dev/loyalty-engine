import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from 'react-router';
import {useFetcher, useLoaderData} from 'react-router';
import {useEffect} from 'react';
import {boundary} from '@shopify/shopify-app-react-router/server';
import {useAppBridge} from '@shopify/app-bridge-react';
import {
  fetchProgramEnabled,
  setProgramEnabled,
} from '../loyalty/settings.server';
import {fetchLoyaltyProgramConfiguration} from '../loyalty/program.server';
import {authenticate} from '../shopify.server';

type ActionData = {
  status: 'success' | 'error';
  message: string;
  enabled?: boolean;
  syncedAt: string;
};

export const loader = async ({request}: LoaderFunctionArgs) => {
  const {admin} = await authenticate.admin(request);
  const [{enabled, shopId}, configuration] = await Promise.all([
    fetchProgramEnabled(admin),
    fetchLoyaltyProgramConfiguration(admin),
  ]);

  return {
    enabled,
    shopId,
    hasProgram: Boolean(configuration.syncPlan.program),
    sourceCounts: {
      tiers: configuration.tierEntries.length,
      benefits: configuration.benefitEntries.length,
      earnRules: configuration.earnRuleEntries.length,
      redemptions: configuration.redemptionEntries.length,
    },
    discountId: configuration.currentDiscountId,
    storefrontWired:
      configuration.tierEntries.length > 0 &&
      configuration.redemptionEntries.length > 0,
  };
};

export const action = async ({request}: ActionFunctionArgs): Promise<ActionData> => {
  const {admin} = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get('intent');

  try {
    if (intent === 'toggleProgram') {
      const desired = formData.get('enabled') === 'true';
      const {shopId} = await fetchProgramEnabled(admin);
      await setProgramEnabled(admin, shopId, desired);
      return {
        status: 'success',
        message: desired
          ? 'Loyalty program activated.'
          : 'Loyalty program paused.',
        enabled: desired,
        syncedAt: new Date().toISOString(),
      };
    }
    return {
      status: 'error',
      message: 'Unknown settings action.',
      syncedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Failed to update settings.',
      syncedAt: new Date().toISOString(),
    };
  }
};

export default function SettingsRoute() {
  const data = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const toggleFetcher = useFetcher<ActionData>();
  const isToggling =
    toggleFetcher.state === 'submitting' || toggleFetcher.state === 'loading';
  const optimisticEnabled =
    toggleFetcher.formData?.get('enabled') === 'true'
      ? true
      : toggleFetcher.formData?.get('enabled') === 'false'
        ? false
        : data.enabled;

  useEffect(() => {
    const next = toggleFetcher.data;
    if (!next?.message) return;
    const prefix = next.status === 'error' ? 'Error: ' : '';
    shopify.toast.show(`${prefix}${next.message}`);
  }, [
    toggleFetcher.data?.message,
    toggleFetcher.data?.status,
    toggleFetcher.data?.syncedAt,
    shopify,
  ]);

  const toggle = (enabled: boolean) => {
    const formData = new FormData();
    formData.set('intent', 'toggleProgram');
    formData.set('enabled', enabled ? 'true' : 'false');
    void toggleFetcher.submit(formData, {method: 'POST'});
  };

  return (
    <s-page heading="Settings">
      <s-section heading="Program status">
        <s-paragraph>
          Master switch for the loyalty program. When paused, the discount
          function emits no candidates at checkout, the storefront hides the
          rewards launcher, and points-awarding webhooks no-op.
        </s-paragraph>

        <s-stack direction="block" gap="base">
          <s-banner
            tone={optimisticEnabled ? 'success' : 'warning'}
            heading={optimisticEnabled ? 'Live mode' : 'Paused'}
          >
            <s-paragraph>
              {optimisticEnabled
                ? 'Customers see and earn points; checkout discounts apply.'
                : 'Program is paused. No new points awarded, no checkout discounts applied. Existing customer balances are preserved.'}
            </s-paragraph>
          </s-banner>

          <s-stack direction="inline" gap="base">
            <s-button
              variant={optimisticEnabled ? 'secondary' : 'primary'}
              onClick={() => toggle(true)}
              {...(isToggling || optimisticEnabled ? {disabled: true} : {})}
            >
              Activate program
            </s-button>
            <s-button
              tone="critical"
              variant="secondary"
              onClick={() => toggle(false)}
              {...(isToggling || !optimisticEnabled ? {disabled: true} : {})}
            >
              Pause program
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Program health">
        <s-stack direction="block" gap="small">
          <DetailRow label="Program initialized" value={data.hasProgram ? 'Yes' : 'No'} />
          <DetailRow label="Tiers published" value={String(data.sourceCounts.tiers)} />
          <DetailRow label="Earn rules published" value={String(data.sourceCounts.earnRules)} />
          <DetailRow
            label="Redemptions published"
            value={String(data.sourceCounts.redemptions)}
          />
          <DetailRow
            label="Automatic checkout discount"
            value={data.discountId ? 'Connected' : 'Pending'}
          />
          <DetailRow
            label="Storefront redemption wired"
            value={data.storefrontWired ? 'Yes' : 'Not yet (need at least one tier and one redemption)'}
          />
        </s-stack>
      </s-section>

      <s-section heading="Storefront integration">
        <s-paragraph>
          The Hydrogen storefront calls the engine via a server-side API route.
          For redemptions to work end-to-end, the storefront must have these
          environment variables set:
        </s-paragraph>
        <s-unordered-list>
          <s-list-item>
            <s-text variant="strong">LOYALTY_ENGINE_URL</s-text> — the public
            HTTPS URL of this app (e.g. https://amadaflow-loyalty.fly.dev).
          </s-list-item>
          <s-list-item>
            <s-text variant="strong">LOYALTY_ENGINE_SHARED_SECRET</s-text> —
            shared secret. Set the matching{' '}
            <s-text variant="strong">LOYALTY_ENGINE_SHARED_SECRET</s-text> env
            var on this app's host (Fly.io / wherever it is deployed) so both
            sides can authenticate each other.
          </s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section slot="aside" heading="Owned definitions">
        <s-unordered-list>
          <s-list-item>Shop metafield: loyalty_program_enabled (this toggle)</s-list-item>
          <s-list-item>Shop metafield: loyalty_program_snapshot</s-list-item>
          <s-list-item>Customer metafield: loyalty_state</s-list-item>
          <s-list-item>Customer metafield: loyalty_points_balance</s-list-item>
          <s-list-item>Customer metafield: loyalty_active_redemption</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

function DetailRow({label, value}: {label: string; value: string}) {
  return (
    <s-stack direction="inline" gap="base">
      <s-text>{label}</s-text>
      <s-text variant="strong">{value}</s-text>
    </s-stack>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
