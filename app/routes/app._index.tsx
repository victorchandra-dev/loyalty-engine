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
        onClick={saveTiers}
        {...(saveFetcher.state !== 'idle' ? {loading: true} : {})}
      >
        Save tiers
      </s-button>

      <s-section heading="Program control center">
        <s-paragraph>
          Manage the spend tiers, the automatic loyalty discount, and customer
          level synchronization from one place. Saving tiers writes directly to
          the merchant-owned
          <s-text> loyalty_reward_tier </s-text>
          entries for the current store and then refreshes the normalized app
          snapshot.
        </s-paragraph>

        <div style={styles.actionGrid}>
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
        </div>
      </s-section>

      <s-section heading="Tier editor">
        <s-paragraph>
          The current MVP qualification model is lifetime spend. Adjusting the
          tiers here updates both the merchant-facing loyalty content and the
          checkout discount logic.
        </s-paragraph>

        <div style={styles.editorGrid}>
          {tiers.map((tier, index) => (
            <div key={tier.clientId} style={styles.tierCard}>
              <div style={styles.cardHeader}>
                <div>
                  <div style={styles.eyebrow}>Tier {index + 1}</div>
                  <div style={styles.handleText}>
                    Handle: {tier.handle || 'generated on save'}
                  </div>
                </div>
                <button
                  type="button"
                  style={styles.removeButton}
                  onClick={() => removeTierDraft(tier.clientId, setTiers)}
                  disabled={tiers.length === 1}
                >
                  Remove
                </button>
              </div>

              <label style={styles.field}>
                <span style={styles.fieldLabel}>Level label</span>
                <input
                  value={tier.label}
                  onChange={(event) =>
                    updateTierDraft(setTiers, tier.clientId, {
                      label: event.target.value,
                    })
                  }
                  style={styles.input}
                  placeholder="Gold"
                />
              </label>

              <label style={styles.field}>
                <span style={styles.fieldLabel}>Minimum spend</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={tier.minimumSpend}
                  onChange={(event) =>
                    updateTierDraft(setTiers, tier.clientId, {
                      minimumSpend: event.target.value,
                    })
                  }
                  style={styles.input}
                  placeholder="300"
                />
              </label>

              <label style={styles.field}>
                <span style={styles.fieldLabel}>Discount percentage</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={tier.discountPercentage}
                  onChange={(event) =>
                    updateTierDraft(setTiers, tier.clientId, {
                      discountPercentage: event.target.value,
                    })
                  }
                  style={styles.input}
                  placeholder="5"
                />
              </label>
            </div>
          ))}
        </div>

        <div style={styles.editorActions}>
          <button
            type="button"
            style={styles.secondaryButton}
            onClick={() => setTiers((current) => [...current, createEmptyTierDraft(current.length)])}
          >
            Add tier
          </button>
          <div style={styles.helperText}>
            Saving tiers also refreshes the single automatic loyalty discount
            owner managed by this app.
          </div>
        </div>
      </s-section>

      <s-section heading="Current status">
        <div style={styles.statusGrid}>
          <StatusCard
            title="Tier definition"
            lines={[
              `Ready: ${data.definitions.tier ? 'Yes' : 'No'}`,
              `Storefront access: ${data.definitions.tier?.access?.storefront ?? 'Not configured'}`,
              `Display name key: ${data.definitions.tier?.displayNameKey ?? 'Not configured'}`,
              `Fields: ${data.definitions.tier?.fieldDefinitions.length ?? 0}`,
            ]}
          />
          <StatusCard
            title="Benefit definition"
            lines={[
              `Ready: ${data.definitions.benefit ? 'Yes' : 'No'}`,
              `Storefront access: ${data.definitions.benefit?.access?.storefront ?? 'Not configured'}`,
              `Display name key: ${data.definitions.benefit?.displayNameKey ?? 'Not configured'}`,
              `Fields: ${data.definitions.benefit?.fieldDefinitions.length ?? 0}`,
            ]}
          />
          <StatusCard
            title="Program resolution"
            lines={[
              `Currency: ${data.currencyCode}`,
              `Tier entries found: ${data.sourceCounts.tiers}`,
              `Benefit entries found: ${data.sourceCounts.benefits}`,
              `Program resolved: ${data.hasProgram ? 'Yes' : 'No'}`,
            ]}
          />
          <StatusCard
            title="Automatic discount"
            lines={[
              `Configured: ${data.currentDiscountId ? 'Yes' : 'No'}`,
              `Discount tiers resolved: ${data.discountConfiguration?.tiers.length ?? 0}`,
              `Discount id: ${data.currentDiscountId ?? 'Not created yet'}`,
            ]}
          />
        </div>
      </s-section>

      <s-section heading="Resolved rewards">
        {data.benefits.length ? (
          <div style={styles.benefitGrid}>
            {data.benefits.map((benefit) => (
              <div key={benefit.handle} style={styles.detailCard}>
                <div style={styles.detailTitle}>{benefit.displayLabel}</div>
                <div style={styles.detailLine}>Type: {benefit.type}</div>
                <div style={styles.detailLine}>Tier handle: {benefit.tierHandle}</div>
                <div style={styles.detailLine}>
                  Value: {benefit.value === null ? 'n/a' : benefit.value}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <s-paragraph>
            No explicit reward entries were found yet. The current program
            derives discount rewards directly from tier entries, and the empty
            <s-text> loyalty_reward_benefit </s-text>
            definition is ready for future non-discount perks.
          </s-paragraph>
        )}
      </s-section>

      <s-section heading="Configuration issues">
        {data.issues.length ? (
          <div style={styles.issueGrid}>
            {data.issues.map((issue) => (
              <div
                key={`${issue.entryId}:${issue.field}:${issue.message}`}
                style={styles.issueCard}
              >
                <div style={styles.issueTitle}>{issue.severity.toUpperCase()}</div>
                <div style={styles.detailLine}>Entry: {issue.entryId}</div>
                <div style={styles.detailLine}>Field: {issue.field}</div>
                <div style={styles.detailLine}>{issue.message}</div>
              </div>
            ))}
          </div>
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
    <div style={styles.actionCard}>
      <div style={styles.detailTitle}>{title}</div>
      <div style={styles.detailLine}>{description}</div>
      <div>
        <s-button onClick={onAction} {...(loading ? {loading: true} : {})}>
          {buttonLabel}
        </s-button>
      </div>
    </div>
  );
}

function StatusCard({title, lines}: {title: string; lines: string[]}) {
  return (
    <div style={styles.detailCard}>
      <div style={styles.detailTitle}>{title}</div>
      {lines.map((line) => (
        <div key={line} style={styles.detailLine}>
          {line}
        </div>
      ))}
    </div>
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

const styles = {
  actionGrid: {
    display: 'grid',
    gap: '12px',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  },
  actionCard: {
    display: 'grid',
    gap: '12px',
    padding: '16px',
    border: '1px solid var(--p-color-border-secondary)',
    borderRadius: '16px',
    background: 'var(--p-color-bg-surface-secondary)',
  },
  editorGrid: {
    display: 'grid',
    gap: '12px',
  },
  tierCard: {
    display: 'grid',
    gap: '12px',
    padding: '16px',
    border: '1px solid var(--p-color-border-secondary)',
    borderRadius: '16px',
    background:
      'linear-gradient(180deg, rgba(241, 245, 249, 0.95) 0%, rgba(255, 255, 255, 0.98) 100%)',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '12px',
  },
  eyebrow: {
    fontSize: '12px',
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    color: '#64748b',
  },
  handleText: {
    fontSize: '13px',
    color: '#475569',
    marginTop: '4px',
  },
  field: {
    display: 'grid',
    gap: '6px',
  },
  fieldLabel: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#0f172a',
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    borderRadius: '12px',
    border: '1px solid #cbd5e1',
    fontSize: '14px',
    color: '#0f172a',
    background: '#ffffff',
  },
  removeButton: {
    border: '1px solid #cbd5e1',
    borderRadius: '999px',
    padding: '8px 12px',
    fontSize: '13px',
    fontWeight: 600,
    background: '#ffffff',
    color: '#0f172a',
    cursor: 'pointer',
  },
  editorActions: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    marginTop: '16px',
  },
  secondaryButton: {
    border: '1px solid #cbd5e1',
    borderRadius: '999px',
    padding: '10px 16px',
    fontSize: '14px',
    fontWeight: 600,
    background: '#ffffff',
    color: '#0f172a',
    cursor: 'pointer',
  },
  helperText: {
    fontSize: '13px',
    color: '#475569',
  },
  statusGrid: {
    display: 'grid',
    gap: '12px',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  },
  benefitGrid: {
    display: 'grid',
    gap: '12px',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  },
  issueGrid: {
    display: 'grid',
    gap: '12px',
  },
  issueCard: {
    display: 'grid',
    gap: '6px',
    padding: '16px',
    borderRadius: '16px',
    border: '1px solid rgba(239, 68, 68, 0.24)',
    background: 'rgba(254, 242, 242, 0.9)',
  },
  issueTitle: {
    fontSize: '12px',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    color: '#b91c1c',
  },
  detailCard: {
    display: 'grid',
    gap: '8px',
    padding: '16px',
    border: '1px solid var(--p-color-border-secondary)',
    borderRadius: '16px',
    background: 'var(--p-color-bg-surface-secondary)',
  },
  detailTitle: {
    fontSize: '15px',
    fontWeight: 700,
    color: '#0f172a',
  },
  detailLine: {
    fontSize: '14px',
    color: '#334155',
  },
} as const;

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
