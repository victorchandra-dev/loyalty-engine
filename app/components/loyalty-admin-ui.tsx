import type {LoyaltyTierEditorEntry} from '../loyalty/admin.server';
import type {
  LoyaltyEarnRuleEditorEntry,
  LoyaltyRedemptionEditorEntry,
} from '../loyalty/earn-rules-redemptions-admin.server';
import styles from './loyalty-admin-ui.module.css';

export type TierDraft = LoyaltyTierEditorEntry & {
  clientId: string;
};

export type EarnRuleDraft = LoyaltyEarnRuleEditorEntry & {
  clientId: string;
};

export type RedemptionDraft = LoyaltyRedemptionEditorEntry & {
  clientId: string;
};

type TierPatch = Partial<Omit<TierDraft, 'clientId'>>;
type EarnRulePatch = Partial<Omit<EarnRuleDraft, 'clientId'>>;
type RedemptionPatch = Partial<Omit<RedemptionDraft, 'clientId'>>;

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

type EarnRule = {
  handle: string;
  title: string;
  description: string | null;
  action: string;
  pointsValue: number | null;
  active: boolean;
};

type Redemption = {
  handle: string;
  title: string;
  description: string | null;
  pointsCost: number;
  rewardType: string;
  rewardValue: string | null;
  active: boolean;
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
  earnRuleCount = 0,
  redemptionCount = 0,
  issueCount,
  currentDiscountId,
  storefrontWired = false,
}: {
  hasProgram: boolean;
  tierCount: number;
  benefitCount: number;
  earnRuleCount?: number;
  redemptionCount?: number;
  issueCount: number;
  currentDiscountId: string | null;
  storefrontWired?: boolean;
}) {
  return (
    <div className={styles.hero}>
      <div className={styles.heroCopy}>
        <p className={styles.eyebrow}>Loyalty program</p>
        <h1 className={styles.heroTitle}>Tiers, points, redemptions, checkout</h1>
        <p className={styles.heroText}>
          Tier ladder + earn rules that award points + a redemption catalog
          customers spend points on. The discount function applies tier and
          redemption discounts at checkout automatically.
        </p>
      </div>

      <div className={styles.heroMetrics} aria-label="Loyalty program summary">
        <HeroMetric label="Program" value={hasProgram ? 'Ready' : 'Draft'} />
        <HeroMetric label="Tiers" value={String(tierCount)} />
        <HeroMetric label="Earn rules" value={String(earnRuleCount)} />
        <HeroMetric label="Redemptions" value={String(redemptionCount)} />
        <HeroMetric label="Benefits" value={String(benefitCount)} />
        <HeroMetric label="Issues" value={String(issueCount)} />
      </div>

      <div className={styles.heroPills}>
        <div className={styles.discountPill}>
          <span className={styles.pulseDot} />
          {currentDiscountId
            ? 'Automatic discount connected'
            : 'Discount owner pending'}
        </div>
        <div className={styles.discountPill}>
          <span className={styles.pulseDot} />
          {storefrontWired
            ? 'Storefront redemption wired'
            : 'Storefront redemption not yet wired'}
        </div>
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

export function EarnRuleEditor({
  earnRules,
  saving,
  onAddRule,
  onRemoveRule,
  onUpdateRule,
}: {
  earnRules: EarnRuleDraft[];
  saving: boolean;
  onAddRule: () => void;
  onRemoveRule: (clientId: string) => void;
  onUpdateRule: (clientId: string, patch: EarnRulePatch) => void;
}) {
  return (
    <s-section heading="Earn rules">
      <s-paragraph>
        Define what actions earn customers points. The storefront rewards page
        and floating launcher render these in order. Empty list falls back to
        bundled defaults until you publish at least one rule.
      </s-paragraph>

      <div className={styles.tierEditorShell}>
        <div className={styles.tierCards}>
          {earnRules.length === 0 ? (
            <s-paragraph>
              No earn rules drafted. Click "Add earn rule" to start.
            </s-paragraph>
          ) : (
            earnRules.map((rule, index) => (
              <EarnRuleCard
                key={rule.clientId}
                index={index}
                rule={rule}
                onRemove={() => onRemoveRule(rule.clientId)}
                onUpdate={(patch) => onUpdateRule(rule.clientId, patch)}
              />
            ))
          )}
        </div>
      </div>

      <div className={styles.editorFooter}>
        <s-button variant="secondary" onClick={onAddRule}>
          Add earn rule
        </s-button>
        <span className={styles.footerNote}>
          {saving ? 'Saving rules…' : `${earnRules.length} rule(s) drafted`}
        </span>
      </div>
    </s-section>
  );
}

export function RedemptionEditor({
  redemptions,
  saving,
  onAddRedemption,
  onRemoveRedemption,
  onUpdateRedemption,
}: {
  redemptions: RedemptionDraft[];
  saving: boolean;
  onAddRedemption: () => void;
  onRemoveRedemption: (clientId: string) => void;
  onUpdateRedemption: (clientId: string, patch: RedemptionPatch) => void;
}) {
  return (
    <s-section heading="Redemptions">
      <s-paragraph>
        Define how customers can spend points. Sorted by points cost on the
        storefront. Empty list falls back to bundled defaults until you publish
        at least one redemption.
      </s-paragraph>

      <div className={styles.tierEditorShell}>
        <div className={styles.tierCards}>
          {redemptions.length === 0 ? (
            <s-paragraph>
              No redemptions drafted. Click "Add redemption" to start.
            </s-paragraph>
          ) : (
            redemptions.map((redemption, index) => (
              <RedemptionCard
                key={redemption.clientId}
                index={index}
                redemption={redemption}
                onRemove={() => onRemoveRedemption(redemption.clientId)}
                onUpdate={(patch) => onUpdateRedemption(redemption.clientId, patch)}
              />
            ))
          )}
        </div>
      </div>

      <div className={styles.editorFooter}>
        <s-button variant="secondary" onClick={onAddRedemption}>
          Add redemption
        </s-button>
        <span className={styles.footerNote}>
          {saving ? 'Saving redemptions…' : `${redemptions.length} redemption(s) drafted`}
        </span>
      </div>
    </s-section>
  );
}

export function EarnRulesAndRedemptions({
  earnRules,
  redemptions,
}: {
  earnRules: EarnRule[];
  redemptions: Redemption[];
}) {
  return (
    <s-section heading="Earn rules and redemptions">
      <s-stack direction="block" gap="base">
        <s-paragraph>
          Merchant-managed metaobjects of type{' '}
          <s-text variant="strong">loyalty_earn_rule</s-text> and{' '}
          <s-text variant="strong">loyalty_redemption</s-text>. The storefront
          surfaces them on the rewards page and floating launcher; falls back to
          bundled defaults when nothing is published. See
          docs/earn-rules-redemptions.md for the schema.
        </s-paragraph>

        <s-heading level="3">Earn rules ({earnRules.length})</s-heading>
        {earnRules.length ? (
          <div className={styles.rewardGrid}>
            {earnRules.map((rule) => (
              <div className={styles.rewardCard} key={rule.handle}>
                <span className={styles.rewardType}>{rule.action}</span>
                <h3>{rule.title}</h3>
                <DetailLine label="Handle" value={rule.handle} />
                <DetailLine
                  label="Points"
                  value={
                    rule.pointsValue === null
                      ? 'dynamic (e.g. 1pt/$1)'
                      : `+${rule.pointsValue}`
                  }
                />
                {rule.description ? (
                  <DetailLine label="Description" value={rule.description} />
                ) : null}
                <DetailLine label="Active" value={rule.active ? 'yes' : 'no'} />
              </div>
            ))}
          </div>
        ) : (
          <s-paragraph>
            No earn rules published yet. Storefront uses bundled defaults
            (signup, order, birthday, follow, review, referral) until you author
            metaobjects of type <s-text variant="strong">loyalty_earn_rule</s-text>.
          </s-paragraph>
        )}

        <s-heading level="3">Redemptions ({redemptions.length})</s-heading>
        {redemptions.length ? (
          <div className={styles.rewardGrid}>
            {redemptions.map((reward) => (
              <div className={styles.rewardCard} key={reward.handle}>
                <span className={styles.rewardType}>{reward.rewardType}</span>
                <h3>{reward.title}</h3>
                <DetailLine label="Handle" value={reward.handle} />
                <DetailLine
                  label="Points cost"
                  value={reward.pointsCost.toLocaleString()}
                />
                {reward.rewardValue ? (
                  <DetailLine label="Reward value" value={reward.rewardValue} />
                ) : null}
                {reward.description ? (
                  <DetailLine label="Description" value={reward.description} />
                ) : null}
                <DetailLine
                  label="Active"
                  value={reward.active ? 'yes' : 'no'}
                />
              </div>
            ))}
          </div>
        ) : (
          <s-paragraph>
            No redemptions published yet. Storefront uses bundled defaults ($10,
            $25, $60 off, free shipping, early access) until you author
            metaobjects of type <s-text variant="strong">loyalty_redemption</s-text>.
          </s-paragraph>
        )}
      </s-stack>
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
          Merchant-owned tier, benefit, earn-rule, and redemption metaobjects.
        </s-list-item>
        <s-list-item>
          The single automatic app discount that powers checkout execution.
        </s-list-item>
        <s-list-item>
          Per-customer points balance (loyalty_points_balance) + active
          redemption (loyalty_active_redemption) metafields.
        </s-list-item>
        <s-list-item>
          Shop snapshot sync, customer loyalty level backfills, and the
          orders/paid points-awarding webhook.
        </s-list-item>
        <s-list-item>
          The /api/redeem endpoint that the storefront calls to spend points.
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
          <p>{tier.handle || 'handle on save'}</p>
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
          label="Min. spend"
          min={0}
          placeholder="300"
          step={0.01}
          value={tier.minimumSpend}
          onChange={(event: Event) =>
            onUpdate({minimumSpend: getEventValue(event)})
          }
        />
        <s-number-field
          label="Discount %"
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

      <div className={styles.tierSummary}>
        <em>Unlocks at</em>
        <strong>
          {spend === null ? '—' : formatCurrency(spend, currencyCode)}
        </strong>
        <em>·</em>
        <em>Checkout reward</em>
        <strong>{discount === null ? '—' : `${discount}% off`}</strong>
      </div>
    </div>
  );
}

const EARN_RULE_ACTION_CHOICES = [
  {value: 'signup', label: 'Sign up'},
  {value: 'order', label: 'Place an order'},
  {value: 'birthday', label: 'Birthday'},
  {value: 'follow_instagram', label: 'Follow on Instagram'},
  {value: 'follow_tiktok', label: 'Follow on TikTok'},
  {value: 'review', label: 'Leave a review'},
  {value: 'referral', label: 'Refer a friend'},
  {value: 'newsletter', label: 'Newsletter signup'},
  {value: 'custom', label: 'Custom'},
] as const;

const REDEMPTION_REWARD_CHOICES = [
  {value: 'fixed_discount', label: 'Fixed-amount discount'},
  {value: 'percent_discount', label: 'Percent discount'},
  {value: 'free_shipping', label: 'Free shipping'},
  {value: 'free_product', label: 'Free product'},
  {value: 'early_access', label: 'Early access'},
] as const;

function EarnRuleCard({
  rule,
  index,
  onRemove,
  onUpdate,
}: {
  rule: EarnRuleDraft;
  index: number;
  onRemove: () => void;
  onUpdate: (patch: EarnRulePatch) => void;
}) {
  return (
    <div className={`${styles.tierCard} ${styles.defaultTier}`}>
      <div className={styles.tierCardHeader}>
        <div>
          <span className={styles.tierBadge}>Rule {index + 1}</span>
          <h3>{rule.title || `Untitled rule ${index + 1}`}</h3>
          <p>Handle: {rule.handle || 'generated on save'}</p>
        </div>
        <s-button tone="critical" variant="tertiary" onClick={onRemove}>
          Remove
        </s-button>
      </div>

      <div className={styles.tierFields}>
        <s-text-field
          label="Title"
          placeholder="Place an order"
          value={rule.title}
          onChange={(event: Event) => onUpdate({title: getEventValue(event)})}
        />
        <s-select
          label="Action"
          value={rule.action}
          onChange={(event: Event) => onUpdate({action: getEventValue(event)})}
        >
          {EARN_RULE_ACTION_CHOICES.map((choice) => (
            <s-option key={choice.value} value={choice.value}>
              {choice.label}
            </s-option>
          ))}
        </s-select>
        <s-number-field
          label="Points awarded (leave blank for dynamic, e.g. 1pt/$1)"
          min={0}
          placeholder="200"
          step={1}
          value={rule.pointsValue}
          onChange={(event: Event) =>
            onUpdate({pointsValue: getEventValue(event)})
          }
        />
        <s-text-field
          label="Description"
          placeholder="Welcome bonus when you join."
          value={rule.description}
          onChange={(event: Event) =>
            onUpdate({description: getEventValue(event)})
          }
        />
        <s-select
          label="Active"
          value={rule.active}
          onChange={(event: Event) => onUpdate({active: getEventValue(event)})}
        >
          <s-option value="true">Active</s-option>
          <s-option value="false">Inactive</s-option>
        </s-select>
      </div>
    </div>
  );
}

function RedemptionCard({
  redemption,
  index,
  onRemove,
  onUpdate,
}: {
  redemption: RedemptionDraft;
  index: number;
  onRemove: () => void;
  onUpdate: (patch: RedemptionPatch) => void;
}) {
  return (
    <div className={`${styles.tierCard} ${styles.defaultTier}`}>
      <div className={styles.tierCardHeader}>
        <div>
          <span className={styles.tierBadge}>Reward {index + 1}</span>
          <h3>{redemption.title || `Untitled reward ${index + 1}`}</h3>
          <p>Handle: {redemption.handle || 'generated on save'}</p>
        </div>
        <s-button tone="critical" variant="tertiary" onClick={onRemove}>
          Remove
        </s-button>
      </div>

      <div className={styles.tierFields}>
        <s-text-field
          label="Title"
          placeholder="$10 off your order"
          value={redemption.title}
          onChange={(event: Event) => onUpdate({title: getEventValue(event)})}
        />
        <s-select
          label="Reward type"
          value={redemption.rewardType}
          onChange={(event: Event) =>
            onUpdate({rewardType: getEventValue(event)})
          }
        >
          {REDEMPTION_REWARD_CHOICES.map((choice) => (
            <s-option key={choice.value} value={choice.value}>
              {choice.label}
            </s-option>
          ))}
        </s-select>
        <s-number-field
          label="Points cost"
          min={0}
          placeholder="500"
          step={1}
          value={redemption.pointsCost}
          onChange={(event: Event) =>
            onUpdate({pointsCost: getEventValue(event)})
          }
        />
        <s-text-field
          label="Reward value (e.g. 10 for $10 off, 15 for 15%)"
          placeholder="10"
          value={redemption.rewardValue}
          onChange={(event: Event) =>
            onUpdate({rewardValue: getEventValue(event)})
          }
        />
        <s-text-field
          label="Description"
          placeholder="24-hour head start on new collections."
          value={redemption.description}
          onChange={(event: Event) =>
            onUpdate({description: getEventValue(event)})
          }
        />
        <s-select
          label="Active"
          value={redemption.active}
          onChange={(event: Event) => onUpdate({active: getEventValue(event)})}
        >
          <s-option value="true">Active</s-option>
          <s-option value="false">Inactive</s-option>
        </s-select>
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
