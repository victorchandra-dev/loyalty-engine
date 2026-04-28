import type {LoyaltyTierEditorEntry} from '../loyalty/admin.server';
import styles from './loyalty-admin-ui.module.css';

export type TierDraft = LoyaltyTierEditorEntry & {
  clientId: string;
};

type TierPatch = Partial<Omit<TierDraft, 'clientId'>>;

type TierDefinition = {
  access: {
    storefront: string | null;
  } | null;
  displayNameKey: string | null;
  fieldDefinitions: Array<unknown>;
} | null;

type Benefit = {
  handle: string;
  displayLabel: string;
  tierHandle: string;
  type: string;
  value: number | null;
};

type ConfigurationIssue = {
  entryId: string;
  field: string;
  message: string;
  severity: 'error' | 'warning';
};

type DiscountConfiguration = {
  tiers: Array<{
    label: string;
    percentage: number;
    threshold: number;
    tierHandle: string;
  }>;
} | null;

const TIER_VISUALS = [
  {label: 'Bronze', className: styles.bronzeTier},
  {label: 'Silver', className: styles.silverTier},
  {label: 'Gold', className: styles.goldTier},
  {label: 'Platinum', className: styles.platinumTier},
] as const;

export function ProgramHero({
  hasProgram,
  tierCount,
  benefitCount,
  issueCount,
  currentDiscountId,
}: {
  hasProgram: boolean;
  tierCount: number;
  benefitCount: number;
  issueCount: number;
  currentDiscountId: string | null;
}) {
  return (
    <div className={styles.hero}>
      <div className={styles.heroCopy}>
        <p className={styles.eyebrow}>Loyalty program</p>
        <h1 className={styles.heroTitle}>Spend tiers, rewards, and checkout sync</h1>
        <p className={styles.heroText}>
          Manage the merchant-owned tier entries that power storefront reward
          messaging and the automatic checkout discount.
        </p>
      </div>

      <div className={styles.heroMetrics} aria-label="Loyalty program summary">
        <HeroMetric label="Program" value={hasProgram ? 'Ready' : 'Draft'} />
        <HeroMetric label="Tiers" value={String(tierCount)} />
        <HeroMetric label="Benefits" value={String(benefitCount)} />
        <HeroMetric label="Issues" value={String(issueCount)} />
      </div>

      <div className={styles.discountPill}>
        <span className={styles.pulseDot} />
        {currentDiscountId ? 'Automatic discount connected' : 'Discount owner pending'}
      </div>
    </div>
  );
}

export function OperationsGrid({
  initializeProgram,
  syncProgram,
  syncCustomers,
  initializeLoading,
  syncLoading,
  customerSyncLoading,
}: {
  initializeProgram: () => void;
  syncProgram: () => void;
  syncCustomers: () => void;
  initializeLoading: boolean;
  syncLoading: boolean;
  customerSyncLoading: boolean;
}) {
  return (
    <s-section heading="Program control center">
      <s-paragraph>
        Use these actions to initialize Shopify definitions, refresh the
        normalized program snapshot, and backfill customer loyalty levels.
      </s-paragraph>

      <div className={styles.actionGrid}>
        <ActionCard
          title="Initialize default program"
          description="Create missing loyalty definitions, seed starter tiers, and prepare the app discount owner."
          buttonLabel="Initialize program"
          onAction={initializeProgram}
          loading={initializeLoading}
        />
        <ActionCard
          title="Sync program state"
          description="Rebuild the normalized shop snapshot and refresh checkout discount configuration."
          buttonLabel="Sync program"
          onAction={syncProgram}
          loading={syncLoading}
        />
        <ActionCard
          title="Sync customer levels"
          description="Backfill current tier and active reward state into customer app metafields."
          buttonLabel="Sync customers"
          onAction={syncCustomers}
          loading={customerSyncLoading}
        />
      </div>
    </s-section>
  );
}

export function TierEditor({
  tiers,
  currencyCode,
  saving,
  onAddTier,
  onRemoveTier,
  onUpdateTier,
}: {
  tiers: TierDraft[];
  currencyCode: string;
  saving: boolean;
  onAddTier: () => void;
  onRemoveTier: (clientId: string) => void;
  onUpdateTier: (clientId: string, patch: TierPatch) => void;
}) {
  return (
    <s-section heading="Tier editor">
      <s-paragraph>
        Keep the spend threshold model, but manage each level as a reward card
        with a live checkout benefit preview.
      </s-paragraph>

      <div className={styles.tierEditorShell}>
        <div className={styles.tierCards}>
          {tiers.map((tier, index) => (
            <TierCard
              key={tier.clientId}
              currencyCode={currencyCode}
              index={index}
              tier={tier}
              disableRemove={tiers.length === 1}
              onRemove={() => onRemoveTier(tier.clientId)}
              onUpdate={(patch) => onUpdateTier(tier.clientId, patch)}
            />
          ))}
        </div>

        <TierLadderPreview currencyCode={currencyCode} tiers={tiers} />
      </div>

      <div className={styles.editorFooter}>
        <s-button variant="secondary" onClick={onAddTier}>
          Add tier
        </s-button>
        <span className={styles.footerNote}>
          {saving
            ? 'Saving tier changes and refreshing checkout rewards.'
            : 'Saving tiers also refreshes the automatic loyalty discount owner.'}
        </span>
      </div>
    </s-section>
  );
}

export function ProgramStatus({
  currencyCode,
  sourceCounts,
  definitions,
  hasProgram,
  currentDiscountId,
  discountConfiguration,
}: {
  currencyCode: string;
  sourceCounts: {tiers: number; benefits: number};
  definitions: {tier: TierDefinition; benefit: TierDefinition};
  hasProgram: boolean;
  currentDiscountId: string | null;
  discountConfiguration: DiscountConfiguration;
}) {
  return (
    <s-section heading="Current status">
      <div className={styles.statusGrid}>
        <StatusCard
          title="Tier definition"
          ready={!!definitions.tier}
          lines={[
            [
              'Storefront access',
              definitions.tier?.access?.storefront ?? 'Not configured',
            ],
            [
              'Display key',
              definitions.tier?.displayNameKey ?? 'Not configured',
            ],
            ['Fields', String(definitions.tier?.fieldDefinitions.length ?? 0)],
          ]}
        />
        <StatusCard
          title="Benefit definition"
          ready={!!definitions.benefit}
          lines={[
            [
              'Storefront access',
              definitions.benefit?.access?.storefront ?? 'Not configured',
            ],
            [
              'Display key',
              definitions.benefit?.displayNameKey ?? 'Not configured',
            ],
            ['Fields', String(definitions.benefit?.fieldDefinitions.length ?? 0)],
          ]}
        />
        <StatusCard
          title="Program resolution"
          ready={hasProgram}
          lines={[
            ['Currency', currencyCode],
            ['Tier entries', String(sourceCounts.tiers)],
            ['Benefit entries', String(sourceCounts.benefits)],
          ]}
        />
        <StatusCard
          title="Automatic discount"
          ready={!!currentDiscountId}
          lines={[
            [
              'Reward tiers',
              String(discountConfiguration?.tiers.length ?? 0),
            ],
            ['Discount id', currentDiscountId ?? 'Not created yet'],
          ]}
        />
      </div>
    </s-section>
  );
}

export function ResolvedRewards({
  benefits,
}: {
  benefits: Benefit[];
}) {
  return (
    <s-section heading="Resolved rewards">
      {benefits.length ? (
        <div className={styles.rewardGrid}>
          {benefits.map((benefit) => (
            <div className={styles.rewardCard} key={benefit.handle}>
              <span className={styles.rewardType}>{benefit.type}</span>
              <h3>{benefit.displayLabel}</h3>
              <DetailLine label="Tier handle" value={benefit.tierHandle} />
              <DetailLine
                label="Value"
                value={benefit.value === null ? 'n/a' : String(benefit.value)}
              />
            </div>
          ))}
        </div>
      ) : (
        <s-paragraph>
          No explicit reward entries were found. Discount rewards are currently
          derived directly from tier entries, while the benefit definition stays
          ready for future perks.
        </s-paragraph>
      )}
    </s-section>
  );
}

export function ConfigurationIssues({
  issues,
}: {
  issues: ConfigurationIssue[];
}) {
  return (
    <s-section heading="Configuration issues">
      {issues.length ? (
        <s-stack direction="block" gap="base">
          {issues.map((issue) => (
            <s-banner
              heading={`${issue.severity.toUpperCase()} - ${issue.field}`}
              key={`${issue.entryId}:${issue.field}:${issue.message}`}
              tone={issue.severity === 'error' ? 'critical' : 'warning'}
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
  );
}

export function OwnershipAside() {
  return (
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
  );
}

function TierCard({
  tier,
  index,
  currencyCode,
  disableRemove,
  onRemove,
  onUpdate,
}: {
  tier: TierDraft;
  index: number;
  currencyCode: string;
  disableRemove: boolean;
  onRemove: () => void;
  onUpdate: (patch: TierPatch) => void;
}) {
  const visual = getTierVisual(index);
  const spend = parseDraftNumber(tier.minimumSpend);
  const discount = parseDraftNumber(tier.discountPercentage);

  return (
    <div className={`${styles.tierCard} ${visual.className}`}>
      <div className={styles.tierCardHeader}>
        <div>
          <span className={styles.tierBadge}>{visual.label}</span>
          <h3>{tier.label || `Tier ${index + 1}`}</h3>
          <p>Handle: {tier.handle || 'generated on save'}</p>
        </div>
        <s-button
          tone="critical"
          variant="tertiary"
          onClick={onRemove}
          {...(disableRemove ? {disabled: true} : {})}
        >
          Remove
        </s-button>
      </div>

      <div className={styles.tierFields}>
        <s-text-field
          label="Tier name"
          placeholder="Gold"
          value={tier.label}
          onChange={(event: Event) =>
            onUpdate({label: getEventValue(event)})
          }
        />
        <s-number-field
          label="Minimum spend"
          min={0}
          placeholder="300"
          step={0.01}
          value={tier.minimumSpend}
          onChange={(event: Event) =>
            onUpdate({minimumSpend: getEventValue(event)})
          }
        />
        <s-number-field
          label="Discount percentage"
          max={100}
          min={0}
          placeholder="5"
          step={0.01}
          value={tier.discountPercentage}
          onChange={(event: Event) =>
            onUpdate({discountPercentage: getEventValue(event)})
          }
        />
      </div>

      <div className={styles.tierPreview}>
        <PreviewMetric
          label="Unlocks at"
          value={spend === null ? '--' : formatCurrency(spend, currencyCode)}
        />
        <PreviewMetric
          label="Checkout reward"
          value={discount === null ? '--' : `${discount}% off`}
        />
      </div>
    </div>
  );
}

function TierLadderPreview({
  tiers,
  currencyCode,
}: {
  tiers: TierDraft[];
  currencyCode: string;
}) {
  return (
    <aside className={styles.ladderPanel}>
      <div>
        <p className={styles.eyebrow}>Live reward preview</p>
        <h3>Tier ladder</h3>
        <p>
          Customers move through these levels as their lifetime paid order spend
          grows.
        </p>
      </div>

      <div className={styles.ladderTrack}>
        {tiers.map((tier, index) => {
          const visual = getTierVisual(index);
          const spend = parseDraftNumber(tier.minimumSpend);
          const discount = parseDraftNumber(tier.discountPercentage);

          return (
            <div className={styles.ladderRow} key={tier.clientId}>
              <span className={`${styles.ladderMarker} ${visual.className}`} />
              <div>
                <strong>{tier.label || visual.label}</strong>
                <span>
                  {spend === null ? 'Set a spend threshold' : formatCurrency(spend, currencyCode)}
                  {' -> '}
                  {discount === null ? 'Set a reward' : `${discount}% off`}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
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
    <div className={styles.actionCard}>
      <h3>{title}</h3>
      <p>{description}</p>
      <s-button onClick={onAction} {...(loading ? {loading: true} : {})}>
        {buttonLabel}
      </s-button>
    </div>
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
    <div className={styles.statusCard}>
      <div className={styles.statusHeader}>
        <h3>{title}</h3>
        <s-badge tone={ready ? 'success' : 'neutral'}>
          {ready ? 'Ready' : 'Not ready'}
        </s-badge>
      </div>
      {lines.map(([label, value]) => (
        <DetailLine key={label} label={label} value={value} />
      ))}
    </div>
  );
}

function HeroMetric({label, value}: {label: string; value: string}) {
  return (
    <div className={styles.heroMetric}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PreviewMetric({label, value}: {label: string; value: string}) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DetailLine({label, value}: {label: string; value: string}) {
  return (
    <div className={styles.detailLine}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function getTierVisual(index: number) {
  return (
    TIER_VISUALS[index] ?? {
      label: `Tier ${index + 1}`,
      className: styles.defaultTier,
    }
  );
}

function parseDraftNumber(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatCurrency(amount: number, currencyCode: string) {
  return new Intl.NumberFormat('en-US', {
    currency: currencyCode,
    maximumFractionDigits: 0,
    style: 'currency',
  }).format(amount);
}

function getEventValue(event: Event) {
  return (event.currentTarget as HTMLInputElement).value;
}
