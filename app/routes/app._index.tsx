import {useEffect, useState} from 'react';
import type {Dispatch, SetStateAction} from 'react';
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from 'react-router';
import {useFetcher, useLoaderData} from 'react-router';
import {useAppBridge} from '@shopify/app-bridge-react';
import {boundary} from '@shopify/shopify-app-react-router/server';
import {
  ConfigurationIssues,
  EarnRuleEditor,
  IntegrationReadiness,
  OperationsGrid,
  ProgramHero,
  ProgramStatus,
  RedemptionEditor,
  ResolvedRewards,
  TierEditor,
  type EarnRuleDraft,
  type RedemptionDraft,
  type TierDraft,
} from '../components/loyalty-admin-ui';
import {
  backfillCustomerLoyaltyLevels,
  buildTierEditorEntries,
  initializeLoyaltyProgram,
  reconcileLoyaltyProgram,
  saveTierConfiguration,
  type LoyaltyTierEditorEntry,
  type LoyaltyTierInput,
} from '../loyalty/admin.server';
import {
  buildEarnRuleEditorEntries,
  buildRedemptionEditorEntries,
  saveEarnRuleConfiguration,
  saveRedemptionConfiguration,
  type LoyaltyEarnRuleEditorEntry,
  type LoyaltyEarnRuleInput,
  type LoyaltyRedemptionEditorEntry,
  type LoyaltyRedemptionInput,
} from '../loyalty/earn-rules-redemptions-admin.server';
import {
  fetchDisplaySettings,
  fetchProgramEnabled,
  setProgramEnabled,
} from '../loyalty/settings.server';
import {
  fetchLoyaltyProgramConfiguration,
  syncShopProgramSnapshot,
} from '../loyalty/program.server';
import {authenticate} from '../shopify.server';

type ActionData = {
  status: 'success' | 'error';
  intent:
    | 'initializeProgram'
    | 'saveTiers'
    | 'saveEarnRules'
    | 'saveRedemptions'
    | 'syncProgram'
    | 'syncCustomers'
    | 'toggleProgram';
  message: string;
  syncedAt: string;
  hasProgram?: boolean;
  issueCount?: number;
  tierEditorTiers?: LoyaltyTierEditorEntry[];
  earnRuleEditorEntries?: LoyaltyEarnRuleEditorEntry[];
  redemptionEditorEntries?: LoyaltyRedemptionEditorEntry[];
  syncedCustomers?: number;
  enabled?: boolean;
};

export const loader = async ({request}: LoaderFunctionArgs) => {
  const {admin} = await authenticate.admin(request);
  const [configuration, enabledState, displayState] = await Promise.all([
    fetchLoyaltyProgramConfiguration(admin),
    fetchProgramEnabled(admin),
    fetchDisplaySettings(admin),
  ]);

  return {
    enabled: enabledState.enabled,
    shopDomain: enabledState.shopDomain ?? displayState.shopDomain,
    displaySettings: displayState.settings,
    currencyCode: configuration.currencyCode,
    currentDiscountId: configuration.currentDiscountId,
    hasProgram: Boolean(configuration.syncPlan.program),
    tiers: configuration.syncPlan.program?.tiers ?? [],
    benefits: configuration.syncPlan.program?.benefits ?? [],
    earnRules: configuration.syncPlan.program?.earnRules ?? [],
    redemptions: configuration.syncPlan.program?.redemptions ?? [],
    issues: configuration.syncPlan.issues,
    sourceCounts: {
      tiers: configuration.tierEntries.length,
      benefits: configuration.benefitEntries.length,
      earnRules: configuration.earnRuleEntries.length,
      redemptions: configuration.redemptionEntries.length,
    },
    /**
     * The storefront-redemption loop is "wired" when:
     *   1. The program has at least one tier (otherwise the function has no
     *      tier discount to layer redemption on top of), AND
     *   2. The program has at least one published redemption (otherwise there
     *      is nothing for customers to redeem).
     * The metafield definition for $app.loyalty_active_redemption is
     * declared in shopify.app.toml and is created by Shopify on app deploy;
     * we don't probe its existence here to keep the loader cheap.
     */
    storefrontWired:
      configuration.tierEntries.length > 0 &&
      configuration.redemptionEntries.length > 0,
    tierEditorTiers: buildTierEditorEntries(configuration.tierEntries),
    earnRuleEditorEntries: buildEarnRuleEditorEntries(
      configuration.earnRuleEntries,
    ),
    redemptionEditorEntries: buildRedemptionEditorEntries(
      configuration.redemptionEntries,
    ),
    discountConfiguration: configuration.syncPlan.discountConfiguration,
    definitions: {
      tier: configuration.tierDefinition,
      benefit: configuration.benefitDefinition,
    },
  };
};

export const action = async ({request}: ActionFunctionArgs): Promise<ActionData> => {
  const {admin} = await authenticate.admin(request);
  const formData = await request.formData();

  try {
    const intent = getIntent(formData);

    switch (intent) {
      case 'initializeProgram': {
        const configuration = await initializeLoyaltyProgram(admin);

        return buildConfigurationActionData({
          intent,
          message:
            'Loyalty definitions, starter tiers, and the automatic discount are ready.',
          configuration,
        });
      }
      case 'saveTiers': {
        const tiers = parseTierInputs(formData.get('tiersPayload'));
        const result = await saveTierConfiguration({admin, tiers});

        return buildConfigurationActionData({
          intent,
          message: 'Loyalty tiers were saved and synced.',
          configuration: result.configuration,
          tierEditorTiers: result.tiers,
        });
      }
      case 'syncProgram': {
        const configuration = await reconcileLoyaltyProgram(admin);

        return buildConfigurationActionData({
          intent,
          message: 'Loyalty program snapshot and automatic discount were synced.',
          configuration,
        });
      }
      case 'syncCustomers': {
        const result = await backfillCustomerLoyaltyLevels(admin);

        return {
          status: 'success',
          intent,
          message: `Customer loyalty levels were synced for ${result.syncedCustomers} customer(s).`,
          syncedAt: new Date().toISOString(),
          syncedCustomers: result.syncedCustomers,
        };
      }
      case 'saveEarnRules': {
        const earnRules = parseEarnRuleInputs(formData.get('earnRulesPayload'));
        const result = await saveEarnRuleConfiguration({admin, earnRules});

        return {
          ...buildConfigurationActionData({
            intent,
            message: 'Earn rules were saved and synced.',
            configuration: result.configuration,
          }),
          earnRuleEditorEntries: result.earnRules,
        };
      }
      case 'saveRedemptions': {
        const redemptions = parseRedemptionInputs(
          formData.get('redemptionsPayload'),
        );
        const result = await saveRedemptionConfiguration({admin, redemptions});

        return {
          ...buildConfigurationActionData({
            intent,
            message: 'Redemptions were saved and synced.',
            configuration: result.configuration,
          }),
          redemptionEditorEntries: result.redemptions,
        };
      }
      case 'toggleProgram': {
        const desired = formData.get('enabled') === 'true';
        const {shopId} = await fetchProgramEnabled(admin);
        await setProgramEnabled(admin, shopId, desired);
        await syncShopProgramSnapshot(admin);
        return {
          status: 'success',
          intent,
          message: desired
            ? 'Loyalty program activated.'
            : 'Loyalty program paused.',
          syncedAt: new Date().toISOString(),
          enabled: desired,
        };
      }
    }
  } catch (error) {
    return {
      status: 'error',
      intent: 'syncProgram',
      message:
        error instanceof Error
          ? error.message
          : 'Unexpected loyalty admin error.',
      syncedAt: new Date().toISOString(),
    };
  }
};

export default function Index() {
  const data = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const initializeFetcher = useFetcher<ActionData>();
  const saveFetcher = useFetcher<ActionData>();
  const earnRulesSaveFetcher = useFetcher<ActionData>();
  const redemptionsSaveFetcher = useFetcher<ActionData>();
  const syncFetcher = useFetcher<ActionData>();
  const customerSyncFetcher = useFetcher<ActionData>();
  const toggleFetcher = useFetcher<ActionData>();
  const [tiers, setTiers] = useState(() => toTierDrafts(data.tierEditorTiers));
  const [earnRules, setEarnRules] = useState(() =>
    toEarnRuleDrafts(data.earnRuleEditorEntries),
  );
  const [redemptions, setRedemptions] = useState(() =>
    toRedemptionDrafts(data.redemptionEditorEntries),
  );

  useFetcherToast(shopify, initializeFetcher);
  useFetcherToast(shopify, saveFetcher);
  useFetcherToast(shopify, earnRulesSaveFetcher);
  useFetcherToast(shopify, redemptionsSaveFetcher);
  useFetcherToast(shopify, syncFetcher);
  useFetcherToast(shopify, customerSyncFetcher);
  useFetcherToast(shopify, toggleFetcher);

  // Optimistic-state for the toggle so the banner updates without round-trip.
  const optimisticEnabled =
    toggleFetcher.formData?.get('enabled') === 'true'
      ? true
      : toggleFetcher.formData?.get('enabled') === 'false'
        ? false
        : (toggleFetcher.data?.enabled ?? data.enabled);
  const isToggling =
    toggleFetcher.state === 'submitting' || toggleFetcher.state === 'loading';

  useEffect(() => {
    if (saveFetcher.data?.status === 'success' && saveFetcher.data.tierEditorTiers) {
      setTiers(toTierDrafts(saveFetcher.data.tierEditorTiers));
    }
  }, [saveFetcher.data]);

  useEffect(() => {
    if (
      initializeFetcher.data?.status === 'success' &&
      initializeFetcher.data.tierEditorTiers
    ) {
      setTiers(toTierDrafts(initializeFetcher.data.tierEditorTiers));
    }
  }, [initializeFetcher.data]);

  useEffect(() => {
    const next = earnRulesSaveFetcher.data;
    if (next?.status === 'success' && next.earnRuleEditorEntries) {
      setEarnRules(toEarnRuleDrafts(next.earnRuleEditorEntries));
    }
  }, [earnRulesSaveFetcher.data]);

  useEffect(() => {
    const next = redemptionsSaveFetcher.data;
    if (next?.status === 'success' && next.redemptionEditorEntries) {
      setRedemptions(toRedemptionDrafts(next.redemptionEditorEntries));
    }
  }, [redemptionsSaveFetcher.data]);

  const saveTiers = () => {
    const formData = new FormData();
    formData.set('intent', 'saveTiers');
    formData.set('tiersPayload', JSON.stringify(stripClientIds(tiers)));
    saveFetcher.submit(formData, {method: 'POST'});
  };

  const initializeProgram = () => {
    const formData = new FormData();
    formData.set('intent', 'initializeProgram');
    initializeFetcher.submit(formData, {method: 'POST'});
  };

  const syncProgram = () => {
    const formData = new FormData();
    formData.set('intent', 'syncProgram');
    syncFetcher.submit(formData, {method: 'POST'});
  };

  const syncCustomers = () => {
    const formData = new FormData();
    formData.set('intent', 'syncCustomers');
    customerSyncFetcher.submit(formData, {method: 'POST'});
  };

  const saveEarnRules = () => {
    const formData = new FormData();
    formData.set('intent', 'saveEarnRules');
    formData.set(
      'earnRulesPayload',
      JSON.stringify(stripEarnRuleClientIds(earnRules)),
    );
    earnRulesSaveFetcher.submit(formData, {method: 'POST'});
  };

  const saveRedemptions = () => {
    const formData = new FormData();
    formData.set('intent', 'saveRedemptions');
    formData.set(
      'redemptionsPayload',
      JSON.stringify(stripRedemptionClientIds(redemptions)),
    );
    redemptionsSaveFetcher.submit(formData, {method: 'POST'});
  };

  const toggleProgram = (enabled: boolean) => {
    const formData = new FormData();
    formData.set('intent', 'toggleProgram');
    formData.set('enabled', enabled ? 'true' : 'false');
    void toggleFetcher.submit(formData, {method: 'POST'});
  };

  return (
    <s-page heading="Loyalty Engine">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={saveTiers}
        {...(saveFetcher.state !== 'idle' ? {loading: true} : {})}
      >
        Save tiers
      </s-button>

      <s-section>
        <s-banner
          tone={optimisticEnabled ? 'success' : 'warning'}
          heading={
            optimisticEnabled
              ? 'App status: Active · Loyalty program: Live mode'
              : 'App status: Active · Loyalty program: Paused'
          }
        >
          <s-stack direction="block" gap="small">
            <s-paragraph>
              {optimisticEnabled
                ? 'Customers earn points on paid orders, and tier + redemption discounts apply automatically at checkout.'
                : 'The program is paused. Activate to resume points awarding and checkout discounts.'}
            </s-paragraph>
            <s-stack direction="inline" gap="small">
              {optimisticEnabled ? (
                <s-button
                  tone="critical"
                  variant="secondary"
                  onClick={() => toggleProgram(false)}
                  {...(isToggling ? {disabled: true} : {})}
                >
                  Pause program
                </s-button>
              ) : (
                <s-button
                  variant="primary"
                  onClick={() => toggleProgram(true)}
                  {...(isToggling ? {disabled: true} : {})}
                >
                  Activate program
                </s-button>
              )}
            </s-stack>
          </s-stack>
        </s-banner>
      </s-section>

      <ProgramHero
        benefitCount={data.sourceCounts.benefits}
        earnRuleCount={data.sourceCounts.earnRules}
        redemptionCount={data.sourceCounts.redemptions}
        currentDiscountId={data.currentDiscountId}
        hasProgram={data.hasProgram}
        issueCount={data.issues.length}
        tierCount={data.sourceCounts.tiers}
        storefrontWired={data.storefrontWired}
      />

      <IntegrationReadiness
        hasProgram={data.hasProgram}
        hydrogenEnabled={data.displaySettings.hydrogenEnabled}
        liquidEnabled={data.displaySettings.liquidEnabled}
        shopDomain={data.shopDomain}
        storefrontWired={data.storefrontWired}
      />

      <OperationsGrid
        customerSyncLoading={customerSyncFetcher.state !== 'idle'}
        initializeLoading={initializeFetcher.state !== 'idle'}
        initializeProgram={initializeProgram}
        syncLoading={syncFetcher.state !== 'idle'}
        syncCustomers={syncCustomers}
        syncProgram={syncProgram}
      />

      <TierEditor
        currencyCode={data.currencyCode}
        onAddTier={() =>
          setTiers((current) => [
            ...current,
            createEmptyTierDraft(current.length),
          ])
        }
        onRemoveTier={(clientId) => removeTierDraft(clientId, setTiers)}
        onUpdateTier={(clientId, patch) =>
          updateTierDraft(setTiers, clientId, patch)
        }
        saving={saveFetcher.state !== 'idle'}
        tiers={tiers}
      />

      <ProgramStatus
        currencyCode={data.currencyCode}
        currentDiscountId={data.currentDiscountId}
        definitions={data.definitions}
        discountConfiguration={data.discountConfiguration}
        hasProgram={data.hasProgram}
        sourceCounts={data.sourceCounts}
      />

      <ResolvedRewards benefits={data.benefits} />

      <EarnRuleEditor
        earnRules={earnRules}
        saving={earnRulesSaveFetcher.state !== 'idle'}
        onAddRule={() =>
          setEarnRules((current) => [
            ...current,
            createEmptyEarnRuleDraft(current.length),
          ])
        }
        onRemoveRule={(clientId) =>
          setEarnRules((current) =>
            current.filter((rule) => rule.clientId !== clientId),
          )
        }
        onUpdateRule={(clientId, patch) =>
          setEarnRules((current) =>
            current.map((rule) =>
              rule.clientId === clientId ? {...rule, ...patch} : rule,
            ),
          )
        }
        onSave={saveEarnRules}
      />

      <RedemptionEditor
        redemptions={redemptions}
        saving={redemptionsSaveFetcher.state !== 'idle'}
        onAddRedemption={() =>
          setRedemptions((current) => [
            ...current,
            createEmptyRedemptionDraft(current.length),
          ])
        }
        onRemoveRedemption={(clientId) =>
          setRedemptions((current) =>
            current.filter((reward) => reward.clientId !== clientId),
          )
        }
        onUpdateRedemption={(clientId, patch) =>
          setRedemptions((current) =>
            current.map((reward) =>
              reward.clientId === clientId ? {...reward, ...patch} : reward,
            ),
          )
        }
        onSave={saveRedemptions}
      />

      <ConfigurationIssues issues={data.issues} />
    </s-page>
  );
}

function useFetcherToast(
  shopify: ReturnType<typeof useAppBridge>,
  fetcher: {
    data?: ActionData;
  },
) {
  useEffect(() => {
    if (!fetcher.data?.message) {
      return;
    }

    const prefix = fetcher.data.status === 'error' ? 'Error: ' : '';
    shopify.toast.show(`${prefix}${fetcher.data.message}`);
  }, [
    fetcher.data?.message,
    fetcher.data?.status,
    fetcher.data?.syncedAt,
    shopify,
  ]);
}

function getIntent(formData: FormData): ActionData['intent'] {
  const value = formData.get('intent');

  if (
    value === 'initializeProgram' ||
    value === 'saveTiers' ||
    value === 'saveEarnRules' ||
    value === 'saveRedemptions' ||
    value === 'syncProgram' ||
    value === 'syncCustomers' ||
    value === 'toggleProgram'
  ) {
    return value;
  }

  throw new Error('Unknown loyalty action.');
}

function parseEarnRuleInputs(
  rawValue: FormDataEntryValue | null,
): LoyaltyEarnRuleInput[] {
  if (typeof rawValue !== 'string') {
    throw new Error('Earn rules payload is missing.');
  }

  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(rawValue);
  } catch {
    throw new Error('Earn rules payload is not valid JSON.');
  }

  if (!Array.isArray(parsedValue)) {
    throw new Error('Earn rules payload must be an array.');
  }

  return parsedValue.map((value, index) => {
    if (!value || typeof value !== 'object') {
      throw new Error(`Earn rule ${index + 1} is invalid.`);
    }
    const record = value as Record<string, unknown>;
    const rawPoints = record.pointsValue;
    let pointsValue: number | null = null;
    if (typeof rawPoints === 'string' && rawPoints.trim() !== '') {
      const parsed = Number.parseInt(rawPoints, 10);
      if (!Number.isFinite(parsed)) {
        throw new Error(
          `Earn rule ${index + 1}: points value must be an integer.`,
        );
      }
      pointsValue = parsed;
    } else if (typeof rawPoints === 'number' && Number.isFinite(rawPoints)) {
      pointsValue = rawPoints;
    }

    return {
      id: parseOptionalString(record.id),
      handle: parseOptionalString(record.handle),
      title: parseRequiredString(
        record.title,
        `Earn rule ${index + 1} title`,
      ),
      description: parseOptionalString(record.description) ?? '',
      action: parseRequiredString(
        record.action,
        `Earn rule ${index + 1} action`,
      ),
      pointsValue,
      active:
        typeof record.active === 'string' ? record.active !== 'false' : true,
    };
  });
}

function parseRedemptionInputs(
  rawValue: FormDataEntryValue | null,
): LoyaltyRedemptionInput[] {
  if (typeof rawValue !== 'string') {
    throw new Error('Redemptions payload is missing.');
  }

  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(rawValue);
  } catch {
    throw new Error('Redemptions payload is not valid JSON.');
  }

  if (!Array.isArray(parsedValue)) {
    throw new Error('Redemptions payload must be an array.');
  }

  return parsedValue.map((value, index) => {
    if (!value || typeof value !== 'object') {
      throw new Error(`Redemption ${index + 1} is invalid.`);
    }
    const record = value as Record<string, unknown>;
    return {
      id: parseOptionalString(record.id),
      handle: parseOptionalString(record.handle),
      title: parseRequiredString(
        record.title,
        `Redemption ${index + 1} title`,
      ),
      description: parseOptionalString(record.description) ?? '',
      pointsCost: parseRequiredNumber(
        record.pointsCost,
        `Redemption ${index + 1} points cost`,
      ),
      rewardType: parseRequiredString(
        record.rewardType,
        `Redemption ${index + 1} reward type`,
      ),
      rewardValue: parseOptionalString(record.rewardValue) ?? '',
      active:
        typeof record.active === 'string' ? record.active !== 'false' : true,
    };
  });
}

function parseTierInputs(rawValue: FormDataEntryValue | null): LoyaltyTierInput[] {
  if (typeof rawValue !== 'string') {
    throw new Error('Tier payload is missing.');
  }

  let parsedValue: unknown;

  try {
    parsedValue = JSON.parse(rawValue);
  } catch {
    throw new Error('Tier payload is not valid JSON.');
  }

  if (!Array.isArray(parsedValue)) {
    throw new Error('Tier payload must be an array.');
  }

  return parsedValue.map((value, index) => {
    if (!value || typeof value !== 'object') {
      throw new Error(`Tier ${index + 1} is invalid.`);
    }

    const record = value as Record<string, unknown>;

    return {
      id: parseOptionalString(record.id),
      handle: parseOptionalString(record.handle),
      label: parseRequiredString(record.label, `Tier ${index + 1} label`),
      minimumSpend: parseRequiredNumber(
        record.minimumSpend,
        `Tier ${index + 1} minimum spend`,
      ),
      discountPercentage: parseRequiredNumber(
        record.discountPercentage,
        `Tier ${index + 1} discount percentage`,
      ),
    };
  });
}

function buildConfigurationActionData({
  intent,
  message,
  configuration,
  tierEditorTiers = buildTierEditorEntries(configuration.tierEntries),
}: {
  intent: ActionData['intent'];
  message: string;
  configuration: Awaited<ReturnType<typeof fetchLoyaltyProgramConfiguration>>;
  tierEditorTiers?: LoyaltyTierEditorEntry[];
}): ActionData {
  return {
    status: 'success',
    intent,
    message,
    syncedAt: new Date().toISOString(),
    hasProgram: Boolean(configuration.syncPlan.program),
    issueCount: configuration.syncPlan.issues.length,
    tierEditorTiers,
  };
}

function parseOptionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseRequiredString(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required.`);
  }

  return value.trim();
}

function parseRequiredNumber(value: unknown, label: string) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value));

  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be numeric.`);
  }

  return parsed;
}

function toTierDrafts(entries: LoyaltyTierEditorEntry[]): TierDraft[] {
  return entries.map((entry, index) => ({
    ...entry,
    clientId: entry.id ?? entry.handle ?? `tier-${index + 1}`,
  }));
}

function createEmptyTierDraft(index: number): TierDraft {
  return {
    clientId: `draft-${Date.now()}-${index + 1}`,
    id: null,
    handle: null,
    label: '',
    minimumSpend: '',
    discountPercentage: '0',
  };
}

function stripClientIds(tiers: TierDraft[]): LoyaltyTierEditorEntry[] {
  return tiers.map((tier) => ({
    id: tier.id,
    handle: tier.handle,
    label: tier.label,
    minimumSpend: tier.minimumSpend,
    discountPercentage: tier.discountPercentage,
  }));
}

function updateTierDraft(
  setTiers: Dispatch<SetStateAction<TierDraft[]>>,
  clientId: string,
  patch: Partial<Omit<TierDraft, 'clientId'>>,
) {
  setTiers((current) =>
    current.map((tier) =>
      tier.clientId === clientId ? {...tier, ...patch} : tier,
    ),
  );
}

function removeTierDraft(
  clientId: string,
  setTiers: Dispatch<SetStateAction<TierDraft[]>>,
) {
  setTiers((current) => {
    if (current.length === 1) {
      return current;
    }

    return current.filter((tier) => tier.clientId !== clientId);
  });
}

function toEarnRuleDrafts(
  entries: LoyaltyEarnRuleEditorEntry[],
): EarnRuleDraft[] {
  return entries.map((entry, index) => ({
    ...entry,
    clientId: entry.id ?? entry.handle ?? `earn-rule-${index + 1}`,
  }));
}

function toRedemptionDrafts(
  entries: LoyaltyRedemptionEditorEntry[],
): RedemptionDraft[] {
  return entries.map((entry, index) => ({
    ...entry,
    clientId: entry.id ?? entry.handle ?? `redemption-${index + 1}`,
  }));
}

function createEmptyEarnRuleDraft(index: number): EarnRuleDraft {
  return {
    clientId: `earn-rule-draft-${Date.now()}-${index + 1}`,
    id: null,
    handle: null,
    title: '',
    description: '',
    action: 'custom',
    pointsValue: '',
    active: 'true',
  };
}

function createEmptyRedemptionDraft(index: number): RedemptionDraft {
  return {
    clientId: `redemption-draft-${Date.now()}-${index + 1}`,
    id: null,
    handle: null,
    title: '',
    description: '',
    pointsCost: '',
    rewardType: 'fixed_discount',
    rewardValue: '',
    active: 'true',
  };
}

function stripEarnRuleClientIds(
  drafts: EarnRuleDraft[],
): LoyaltyEarnRuleEditorEntry[] {
  return drafts.map((rule) => ({
    id: rule.id,
    handle: rule.handle,
    title: rule.title,
    description: rule.description,
    action: rule.action,
    pointsValue: rule.pointsValue,
    active: rule.active,
  }));
}

function stripRedemptionClientIds(
  drafts: RedemptionDraft[],
): LoyaltyRedemptionEditorEntry[] {
  return drafts.map((reward) => ({
    id: reward.id,
    handle: reward.handle,
    title: reward.title,
    description: reward.description,
    pointsCost: reward.pointsCost,
    rewardType: reward.rewardType,
    rewardValue: reward.rewardValue,
    active: reward.active,
  }));
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
