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
  type LoyaltyDisplaySettings,
  fetchProgramEnabled,
  fetchDisplaySettings,
  setDisplaySettings,
  setProgramEnabled,
} from '../loyalty/settings.server';
import {
  fetchLoyaltyProgramConfiguration,
  syncShopProgramSnapshot,
} from '../loyalty/program.server';
import {authenticate} from '../shopify.server';

type ActionData = {
  status: 'success' | 'error';
  message: string;
  enabled?: boolean;
  displaySettings?: LoyaltyDisplaySettings;
  syncedAt: string;
};

export const loader = async ({request}: LoaderFunctionArgs) => {
  const {admin} = await authenticate.admin(request);
  const [{enabled, shopId, shopDomain}, displayState, configuration] =
    await Promise.all([
    fetchProgramEnabled(admin),
    fetchDisplaySettings(admin),
    fetchLoyaltyProgramConfiguration(admin),
  ]);

  return {
    enabled,
    shopId,
    shopDomain: shopDomain ?? displayState.shopDomain,
    displaySettings: displayState.settings,
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
      await syncShopProgramSnapshot(admin);
      return {
        status: 'success',
        message: desired
          ? 'Loyalty program activated.'
          : 'Loyalty program paused.',
        enabled: desired,
        syncedAt: new Date().toISOString(),
      };
    }
    if (intent === 'saveDisplaySettings') {
      const {shopId} = await fetchDisplaySettings(admin);
      const displaySettings = parseDisplaySettingsForm(formData);
      await setDisplaySettings(admin, shopId, displaySettings);
      await syncShopProgramSnapshot(admin);
      return {
        status: 'success',
        message: 'Display and storefront integration settings were saved.',
        displaySettings,
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
  const settingsFetcher = useFetcher<ActionData>();
  const toggleResult = toggleFetcher.data;
  const settingsResult = settingsFetcher.data;
  const isToggling =
    toggleFetcher.state === 'submitting' || toggleFetcher.state === 'loading';
  const isSavingSettings =
    settingsFetcher.state === 'submitting' || settingsFetcher.state === 'loading';
  const displaySettings =
    settingsResult?.displaySettings ?? data.displaySettings;
  const optimisticEnabled =
    toggleFetcher.formData?.get('enabled') === 'true'
      ? true
      : toggleFetcher.formData?.get('enabled') === 'false'
        ? false
        : data.enabled;

  useEffect(() => {
    const result = toggleResult ?? settingsResult;
    if (!result?.message) return;
    const prefix = result.status === 'error' ? 'Error: ' : '';
    shopify.toast.show(`${prefix}${result.message}`);
  }, [toggleResult, settingsResult, shopify]);

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
            <s-text type="strong">LOYALTY_ENGINE_URL</s-text> — the public
            HTTPS URL of this app (e.g. https://your-engine.example.com).
          </s-list-item>
          <s-list-item>
            <s-text type="strong">LOYALTY_ENGINE_SHARED_SECRET</s-text> —
            shared secret. Set the matching{' '}
            <s-text type="strong">LOYALTY_ENGINE_SHARED_SECRET</s-text> env
            var on this app&apos;s host (Fly.io / wherever it is deployed) so both
            sides can authenticate each other.
          </s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section heading="Display customization">
        <settingsFetcher.Form method="post">
          <input type="hidden" name="intent" value="saveDisplaySettings" />
          <s-stack direction="block" gap="base">
            <s-grid gridTemplateColumns="repeat(auto-fit, minmax(16rem, 1fr))" gap="base">
              <s-text-field
                label="Widget title"
                name="widgetTitle"
                value={displaySettings.widgetTitle}
              />
              <s-text-field
                label="Points label"
                name="pointsLabel"
                value={displaySettings.pointsLabel}
              />
              <s-text-field
                label="Primary color"
                name="primaryColor"
                value={displaySettings.primaryColor}
              />
              <s-text-field
                label="Accent color"
                name="accentColor"
                value={displaySettings.accentColor}
              />
            </s-grid>
            <s-text-field
              label="Widget intro"
              name="widgetIntro"
              value={displaySettings.widgetIntro}
            />
            <s-grid gridTemplateColumns="repeat(auto-fit, minmax(14rem, 1fr))" gap="base">
              <s-select
                label="Launcher position"
                name="launcherPosition"
                value={displaySettings.launcherPosition}
              >
                <s-option value="bottom-right">Bottom right</s-option>
                <s-option value="bottom-left">Bottom left</s-option>
              </s-select>
              <s-select
                label="Floating launcher"
                name="launcherEnabled"
                value={displaySettings.launcherEnabled ? 'true' : 'false'}
              >
                <s-option value="true">Enabled</s-option>
                <s-option value="false">Disabled</s-option>
              </s-select>
              <s-select
                label="Account page"
                name="accountPageEnabled"
                value={displaySettings.accountPageEnabled ? 'true' : 'false'}
              >
                <s-option value="true">Enabled</s-option>
                <s-option value="false">Disabled</s-option>
              </s-select>
              <s-select
                label="Hydrogen storefront"
                name="hydrogenEnabled"
                value={displaySettings.hydrogenEnabled ? 'true' : 'false'}
              >
                <s-option value="true">Supported</s-option>
                <s-option value="false">Hidden</s-option>
              </s-select>
              <s-select
                label="Liquid storefront"
                name="liquidEnabled"
                value={displaySettings.liquidEnabled ? 'true' : 'false'}
              >
                <s-option value="true">Supported</s-option>
                <s-option value="false">Hidden</s-option>
              </s-select>
            </s-grid>
            <s-button
              type="submit"
              variant="primary"
              {...(isSavingSettings ? {loading: true} : {})}
            >
              Save display settings
            </s-button>
          </s-stack>
        </settingsFetcher.Form>
      </s-section>

      <s-section heading="Hydrogen and Liquid support">
        <s-stack direction="block" gap="base">
          <s-banner tone="success" heading="Hydrogen is wired">
            <s-paragraph>
              The Hydrogen storefront reads loyalty metaobjects and customer
              account metafields directly. Customer rewards page:
              /account/loyalty.
            </s-paragraph>
          </s-banner>
          <s-banner
            tone={displaySettings.liquidEnabled ? 'success' : 'warning'}
            heading={
              displaySettings.liquidEnabled
                ? 'Liquid endpoint is available'
                : 'Liquid support is hidden'
            }
          >
            <s-paragraph>
              Liquid themes can fetch the public program JSON after the app is
              installed on the shop. Use this endpoint with the shop domain:
            </s-paragraph>
            <s-text type="strong">
              /api/public-loyalty-program?shop=
              {data.shopDomain ?? 'example.myshopify.com'}
            </s-text>
          </s-banner>
        </s-stack>
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

function parseDisplaySettingsForm(formData: FormData): LoyaltyDisplaySettings {
  return {
    widgetTitle: getString(formData, 'widgetTitle'),
    widgetIntro: getString(formData, 'widgetIntro'),
    pointsLabel: getString(formData, 'pointsLabel'),
    primaryColor: getString(formData, 'primaryColor'),
    accentColor: getString(formData, 'accentColor'),
    launcherPosition:
      formData.get('launcherPosition') === 'bottom-left'
        ? 'bottom-left'
        : 'bottom-right',
    launcherEnabled: formData.get('launcherEnabled') !== 'false',
    accountPageEnabled: formData.get('accountPageEnabled') !== 'false',
    hydrogenEnabled: formData.get('hydrogenEnabled') !== 'false',
    liquidEnabled: formData.get('liquidEnabled') !== 'false',
  };
}

function getString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

function DetailRow({label, value}: {label: string; value: string}) {
  return (
    <s-stack direction="inline" gap="base">
      <s-text>{label}</s-text>
      <s-text type="strong">{value}</s-text>
    </s-stack>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
