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
  OperationsGrid,
  OwnershipAside,
  ProgramHero,
  ProgramStatus,
  ResolvedRewards,
  TierEditor,
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
import {fetchLoyaltyProgramConfiguration} from '../loyalty/program.server';
import {authenticate} from '../shopify.server';

type ActionData = {
  status: 'success' | 'error';
  intent: 'initializeProgram' | 'saveTiers' | 'syncProgram' | 'syncCustomers';
  message: string;
  syncedAt: string;
  hasProgram?: boolean;
  issueCount?: number;
  tierEditorTiers?: LoyaltyTierEditorEntry[];
  syncedCustomers?: number;
};

export const loader = async ({request}: LoaderFunctionArgs) => {
  const {admin} = await authenticate.admin(request);
  const configuration = await fetchLoyaltyProgramConfiguration(admin);

  return {
    currencyCode: configuration.currencyCode,
    currentDiscountId: configuration.currentDiscountId,
    hasProgram: Boolean(configuration.syncPlan.program),
    tiers: configuration.syncPlan.program?.tiers ?? [],
    benefits: configuration.syncPlan.program?.benefits ?? [],
    issues: configuration.syncPlan.issues,
    sourceCounts: {
      tiers: configuration.tierEntries.length,
      benefits: configuration.benefitEntries.length,
    },
    tierEditorTiers: buildTierEditorEntries(configuration.tierEntries),
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
  const syncFetcher = useFetcher<ActionData>();
  const customerSyncFetcher = useFetcher<ActionData>();
  const [tiers, setTiers] = useState(() => toTierDrafts(data.tierEditorTiers));

  useFetcherToast(shopify, initializeFetcher);
  useFetcherToast(shopify, saveFetcher);
  useFetcherToast(shopify, syncFetcher);
  useFetcherToast(shopify, customerSyncFetcher);

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

      <ProgramHero
        benefitCount={data.sourceCounts.benefits}
        currentDiscountId={data.currentDiscountId}
        hasProgram={data.hasProgram}
        issueCount={data.issues.length}
        tierCount={data.sourceCounts.tiers}
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

      <ConfigurationIssues issues={data.issues} />

      <OwnershipAside />
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
    value === 'syncProgram' ||
    value === 'syncCustomers'
  ) {
    return value;
  }

  throw new Error('Unknown loyalty action.');
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

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
