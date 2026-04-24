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

type TierDraft = LoyaltyTierEditorEntry & {
  clientId: string;
};

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

      <s-section heading="Program control center">
        <s-paragraph>
          Manage the spend tiers, the automatic loyalty discount, and customer
          level synchronization from one place. Saving tiers writes directly to
          the merchant-owned{' '}
          <s-text>loyalty_reward_tier</s-text> entries for the
          current store and then refreshes the normalized app snapshot.
        </s-paragraph>

        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))" gap="base">
          <ActionCard
            title="Initialize default program"
            description="Create the loyalty metaobject definitions if they are missing, seed the starter tiers, and ensure the app discount owner exists."
            buttonLabel="Initialize program"
            onAction={initializeProgram}
            loading={initializeFetcher.state !== 'idle'}
          />
          <ActionCard
            title="Sync program state"
            description="Rebuild the normalized shop snapshot and refresh the single automatic discount owner from the current tier configuration."
            buttonLabel="Sync program"
            onAction={syncProgram}
            loading={syncFetcher.state !== 'idle'}
          />
          <ActionCard
            title="Sync customer levels"
            description="Backfill the current loyalty tier and active rewards into customer app metafields for every customer in the store."
            buttonLabel="Sync customers"
            onAction={syncCustomers}
            loading={customerSyncFetcher.state !== 'idle'}
          />
        </s-grid>
      </s-section>

      <s-section heading="Tier editor">
        <s-paragraph>
          The current MVP qualification model is lifetime spend. Adjusting the
          tiers here updates both the merchant-facing loyalty content and the
          checkout discount logic.
        </s-paragraph>

        <s-stack direction="block" gap="base">
          {tiers.map((tier, index) => (
            <s-section key={tier.clientId}>
              <s-stack
                direction="inline"
                alignItems="start"
                justifyContent="space-between"
                gap="base"
              >
                <s-stack direction="block" gap="small">
                  <s-heading>Tier {index + 1}</s-heading>
                  <s-text color="subdued">
                    Handle: {tier.handle || 'generated on save'}
                  </s-text>
                </s-stack>
                <s-button
                  variant="tertiary"
                  tone="critical"
                  onClick={() => removeTierDraft(tier.clientId, setTiers)}
                  {...(tiers.length === 1 ? {disabled: true} : {})}
                >
                  Remove
                </s-button>
              </s-stack>

              <s-text-field
                label="Level label"
                value={tier.label}
                placeholder="Gold"
                onChange={(event: any) =>
                  updateTierDraft(setTiers, tier.clientId, {
                    label: event.currentTarget.value,
                  })
                }
              />

              <s-number-field
                label="Minimum spend"
                value={tier.minimumSpend}
                placeholder="300"
                min={0}
                step={0.01}
                onChange={(event: any) =>
                  updateTierDraft(setTiers, tier.clientId, {
                    minimumSpend: event.currentTarget.value,
                  })
                }
              />

              <s-number-field
                label="Discount percentage"
                value={tier.discountPercentage}
                placeholder="5"
                min={0}
                max={100}
                step={0.01}
                onChange={(event: any) =>
                  updateTierDraft(setTiers, tier.clientId, {
                    discountPercentage: event.currentTarget.value,
                  })
                }
              />
            </s-section>
          ))}
        </s-stack>

        <s-stack
          direction="inline"
          alignItems="center"
          justifyContent="space-between"
          gap="base"
        >
          <s-button
            variant="secondary"
            onClick={() =>
              setTiers((current) => [
                ...current,
                createEmptyTierDraft(current.length),
              ])
            }
          >
            Add tier
          </s-button>
          <s-text color="subdued">
            Saving tiers also refreshes the single automatic loyalty discount
            owner managed by this app.
          </s-text>
        </s-stack>
      </s-section>

      <s-section heading="Current status">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="base">
          <StatusCard
            title="Tier definition"
            ready={!!data.definitions.tier}
            lines={[
              ['Storefront access', data.definitions.tier?.access?.storefront ?? 'Not configured'],
              ['Display name key', data.definitions.tier?.displayNameKey ?? 'Not configured'],
              ['Fields', String(data.definitions.tier?.fieldDefinitions.length ?? 0)],
            ]}
          />
          <StatusCard
            title="Benefit definition"
            ready={!!data.definitions.benefit}
            lines={[
              ['Storefront access', data.definitions.benefit?.access?.storefront ?? 'Not configured'],
              ['Display name key', data.definitions.benefit?.displayNameKey ?? 'Not configured'],
              ['Fields', String(data.definitions.benefit?.fieldDefinitions.length ?? 0)],
            ]}
          />
          <StatusCard
            title="Program resolution"
            ready={data.hasProgram}
            lines={[
              ['Currency', data.currencyCode],
              ['Tier entries found', String(data.sourceCounts.tiers)],
              ['Benefit entries found', String(data.sourceCounts.benefits)],
            ]}
          />
          <StatusCard
            title="Automatic discount"
            ready={!!data.currentDiscountId}
            lines={[
              ['Discount tiers resolved', String(data.discountConfiguration?.tiers.length ?? 0)],
              ['Discount id', data.currentDiscountId ?? 'Not created yet'],
            ]}
          />
        </s-grid>
      </s-section>

      <s-section heading="Resolved rewards">
        {data.benefits.length ? (
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="base">
            {data.benefits.map((benefit) => (
              <s-section key={benefit.handle}>
                <s-stack direction="block" gap="small">
                  <s-heading>{benefit.displayLabel}</s-heading>
                  <DetailLine label="Type" value={benefit.type} />
                  <DetailLine label="Tier handle" value={benefit.tierHandle} />
                  <DetailLine
                    label="Value"
                    value={benefit.value === null ? 'n/a' : String(benefit.value)}
                  />
                </s-stack>
              </s-section>
            ))}
          </s-grid>
        ) : (
          <s-paragraph>
            No explicit reward entries were found yet. The current program
            derives discount rewards directly from tier entries, and the empty{' '}
            <s-text>loyalty_reward_benefit</s-text> definition
            is ready for future non-discount perks.
          </s-paragraph>
        )}
      </s-section>

      <s-section heading="Configuration issues">
        {data.issues.length ? (
          <s-stack direction="block" gap="base">
            {data.issues.map((issue) => (
              <s-banner
                key={`${issue.entryId}:${issue.field}:${issue.message}`}
                tone={issue.severity === 'error' ? 'critical' : 'warning'}
                heading={`${issue.severity.toUpperCase()} · ${issue.field}`}
              >
                <s-stack direction="block" gap="small">
                  <s-text>Entry: {issue.entryId}</s-text>
                  <s-text>{issue.message}</s-text>
                </s-stack>
              </s-banner>
            ))}
          </s-stack>
        ) : (
          <s-paragraph>
            No configuration issues were detected in the current loyalty setup.
          </s-paragraph>
        )}
      </s-section>

      <s-section slot="aside" heading="What this page owns">
        <s-unordered-list>
          <s-list-item>
            Merchant-owned tier and benefit definitions for loyalty config.
          </s-list-item>
          <s-list-item>
            The single automatic app discount that powers checkout execution.
          </s-list-item>
          <s-list-item>
            Shop snapshot sync and customer loyalty level backfills.
          </s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

function ActionCard({
  title,
  description,
  buttonLabel,
  onAction,
  loading,
}: {
  title: string;
  description: string;
  buttonLabel: string;
  onAction: () => void;
  loading: boolean;
}) {
  return (
    <s-section>
      <s-stack direction="block" gap="base">
        <s-stack direction="block" gap="small">
          <s-heading>{title}</s-heading>
          <s-paragraph>{description}</s-paragraph>
        </s-stack>
        <s-button onClick={onAction} {...(loading ? {loading: true} : {})}>
          {buttonLabel}
        </s-button>
      </s-stack>
    </s-section>
  );
}

function StatusCard({
  title,
  ready,
  lines,
}: {
  title: string;
  ready: boolean;
  lines: [label: string, value: string][];
}) {
  return (
    <s-section>
      <s-stack direction="block" gap="small">
        <s-stack
          direction="inline"
          alignItems="center"
          justifyContent="space-between"
          gap="small"
        >
          <s-heading>{title}</s-heading>
          <s-badge tone={ready ? 'success' : 'neutral'}>
            {ready ? 'Ready' : 'Not ready'}
          </s-badge>
        </s-stack>
        {lines.map(([label, value]) => (
          <DetailLine key={label} label={label} value={value} />
        ))}
      </s-stack>
    </s-section>
  );
}

function DetailLine({label, value}: {label: string; value: string}) {
  return (
    <s-stack direction="inline" alignItems="baseline" gap="small">
      <s-text color="subdued">
        {label}:
      </s-text>
      <s-text>{value}</s-text>
    </s-stack>
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
