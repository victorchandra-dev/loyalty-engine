import type {ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs} from 'react-router';
import {Form, Link, useActionData, useLoaderData, useNavigation, useSearchParams} from 'react-router';
import {boundary} from '@shopify/shopify-app-react-router/server';
import {fetchLoyaltyProgramConfiguration} from '../loyalty/program.server';
import {
  reconcilePendingReferrals,
  awardEarnRuleToCustomer,
  type ReconcileReferralsResult,
} from '../loyalty/customer-state.server';
import {isManualEarnEligible} from '../loyalty/constants';
import {adminGraphql} from '../loyalty/graphql.server';
import {authenticate} from '../shopify.server';

const PAGE_SIZE = 25;

const CUSTOMERS_LOYALTY_PAGE_QUERY = `#graphql
  query LoyaltyCustomersPage($first: Int!, $after: String) {
    customers(first: $first, after: $after, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        firstName
        lastName
        email
        amountSpent {
          amount
          currencyCode
        }
        numberOfOrders
        loyaltyState: metafield(namespace: "$app", key: "loyalty_state") {
          value
        }
        pointsBalance: metafield(namespace: "$app", key: "loyalty_points_balance") {
          value
        }
        activeRedemption: metafield(namespace: "$app", key: "loyalty_active_redemption") {
          value
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
` as const;

type CustomersPageQueryData = {
  customers: {
    nodes: Array<{
      id: string;
      firstName: string | null;
      lastName: string | null;
      email: string | null;
      amountSpent: {amount: string; currencyCode: string} | null;
      numberOfOrders: number;
      loyaltyState: {value: string | null} | null;
      pointsBalance: {value: string | null} | null;
      activeRedemption: {value: string | null} | null;
    }>;
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
  };
};

type CustomerRow = {
  id: string;
  name: string;
  email: string;
  lifetimeSpend: number;
  currencyCode: string;
  orders: number;
  pointsBalance: number;
  currentTier: string | null;
  hasActiveRedemption: boolean;
};

export const action = async ({request}: ActionFunctionArgs) => {
  const {admin} = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get('intent');
  const configuration = await fetchLoyaltyProgramConfiguration(admin);
  const program = configuration.syncPlan.program;

  if (intent === 'awardEarnRule') {
    const customerId = formData.get('customerId');
    const ruleHandle = formData.get('ruleHandle');
    if (typeof customerId !== 'string' || !customerId || typeof ruleHandle !== 'string' || !ruleHandle) {
      return {award: {status: 'rejected' as const, message: 'Pick a reward to award.', customerId: typeof customerId === 'string' ? customerId : ''}};
    }
    if (!program) {
      return {award: {status: 'rejected' as const, message: 'Initialize the program first.', customerId}};
    }
    const result = await awardEarnRuleToCustomer({admin, customerAdminId: customerId, ruleHandle, program});
    return {award: {...result, customerId}};
  }

  // Default intent: reconcile pending referrals.
  const bonusPoints = program
    ? (program.earnRules.find((r) => r.active && r.action === 'referral')?.pointsValue ?? 0)
    : 0;
  const result = await reconcilePendingReferrals(admin, bonusPoints);
  return {reconcile: result};
};

export const loader = async ({request}: LoaderFunctionArgs) => {
  const {admin} = await authenticate.admin(request);
  const url = new URL(request.url);
  const cursor = url.searchParams.get('after');

  const [configuration, page] = await Promise.all([
    fetchLoyaltyProgramConfiguration(admin),
    adminGraphql<CustomersPageQueryData>(admin, CUSTOMERS_LOYALTY_PAGE_QUERY, {
      first: PAGE_SIZE,
      ...(cursor ? {after: cursor} : {}),
    }),
  ]);

  const program = configuration.syncPlan.program;
  const manualRules = program
    ? program.earnRules
        .filter((rule) => rule.active && isManualEarnEligible(rule.action))
        .map((rule) => ({
          handle: rule.handle,
          title: rule.title,
          pointsValue: rule.pointsValue,
        }))
    : [];
  const tierLabelByHandle = new Map<string, string>();
  if (program) {
    for (const tier of program.tiers) {
      tierLabelByHandle.set(tier.handle, tier.name);
    }
  }

  const rows: CustomerRow[] = page.customers.nodes.map((node) => {
    const stateRaw = node.loyaltyState?.value;
    let currentTierHandle: string | null = null;
    if (stateRaw) {
      try {
        const state = JSON.parse(stateRaw) as {currentTierHandle?: string | null};
        currentTierHandle = state.currentTierHandle ?? null;
      } catch {
        // ignore parse errors — show as no tier
      }
    }
    const balance = Number.parseInt(node.pointsBalance?.value ?? '0', 10);
    const activeRedemptionRaw = node.activeRedemption?.value;
    const hasActiveRedemption =
      activeRedemptionRaw !== null &&
      activeRedemptionRaw !== undefined &&
      activeRedemptionRaw !== '' &&
      activeRedemptionRaw !== 'null';
    const lifetimeSpend = Number.parseFloat(node.amountSpent?.amount ?? '0');

    return {
      id: node.id,
      name:
        [node.firstName, node.lastName].filter(Boolean).join(' ').trim() ||
        node.email ||
        'Customer',
      email: node.email ?? '—',
      lifetimeSpend: Number.isFinite(lifetimeSpend) ? lifetimeSpend : 0,
      currencyCode:
        node.amountSpent?.currencyCode ?? configuration.currencyCode,
      orders: node.numberOfOrders,
      pointsBalance: Number.isFinite(balance) ? balance : 0,
      currentTier: currentTierHandle
        ? tierLabelByHandle.get(currentTierHandle) ?? currentTierHandle
        : null,
      hasActiveRedemption,
    };
  });

  return {
    rows,
    manualRules,
    cursor: page.customers.pageInfo.hasNextPage
      ? page.customers.pageInfo.endCursor
      : null,
    hasProgram: Boolean(program),
  };
};

export default function CustomersRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [params] = useSearchParams();
  const currentCursor = params.get('after');
  const isReconciling = navigation.state === 'submitting';
  const awardResult = actionData && 'award' in actionData ? actionData.award : undefined;
  const reconcileResult =
    actionData && 'reconcile' in actionData
      ? (actionData.reconcile as ReconcileReferralsResult)
      : undefined;

  const totalActive = data.rows.filter((r) => r.hasActiveRedemption).length;
  const totalPoints = data.rows.reduce((sum, r) => sum + r.pointsBalance, 0);

  return (
    <s-page heading="Customers">
      <s-section heading="Loyalty members">
        <s-paragraph>
          Customers most recently updated, with their loyalty tier, points
          balance, and any active redemption. Page size: {PAGE_SIZE}.
        </s-paragraph>

        {!data.hasProgram ? (
          <s-banner tone="warning" heading="Program not initialised">
            <s-paragraph>
              Initialize the program from the Home tab to start surfacing tier
              labels here.
            </s-paragraph>
          </s-banner>
        ) : null}

        {awardResult ? (
          <s-banner
            tone={
              awardResult.status === 'awarded'
                ? 'success'
                : awardResult.status === 'already_awarded'
                  ? 'info'
                  : 'critical'
            }
          >
            <s-paragraph>{awardResult.message}</s-paragraph>
          </s-banner>
        ) : null}

        <s-stack direction="block" gap="small">
          <s-stack direction="inline" gap="base">
            <s-text>
              On this page:{' '}
              <s-text type="strong">{data.rows.length}</s-text>
            </s-text>
            <s-text>
              Active redemptions:{' '}
              <s-text type="strong">{totalActive}</s-text>
            </s-text>
            <s-text>
              Points outstanding (page):{' '}
              <s-text type="strong">
                {totalPoints.toLocaleString('en-US')}
              </s-text>
            </s-text>
          </s-stack>
        </s-stack>

        {data.rows.length === 0 ? (
          <s-paragraph>No customers found yet.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Customer</s-table-header>
              <s-table-header>Tier</s-table-header>
              <s-table-header>Points balance</s-table-header>
              <s-table-header>Lifetime spend</s-table-header>
              <s-table-header>Orders</s-table-header>
              <s-table-header>Active redemption</s-table-header>
              <s-table-header>Award points</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.rows.map((row) => (
                <s-table-row key={row.id}>
                  <s-table-cell>
                    <s-stack direction="block" gap="small">
                      <s-text type="strong">{row.name}</s-text>
                      <s-text>{row.email}</s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    <s-text>{row.currentTier ?? '—'}</s-text>
                  </s-table-cell>
                  <s-table-cell>
                    <s-text>
                      {row.pointsBalance.toLocaleString('en-US')}
                    </s-text>
                  </s-table-cell>
                  <s-table-cell>
                    <s-text>
                      {formatCurrency(row.lifetimeSpend, row.currencyCode)}
                    </s-text>
                  </s-table-cell>
                  <s-table-cell>
                    <s-text>{row.orders}</s-text>
                  </s-table-cell>
                  <s-table-cell>
                    {row.hasActiveRedemption ? (
                      <s-badge tone="success">Yes</s-badge>
                    ) : (
                      <s-text>—</s-text>
                    )}
                  </s-table-cell>
                  <s-table-cell>
                    {data.manualRules.length > 0 ? (
                      <Form method="post">
                        <input type="hidden" name="intent" value="awardEarnRule" />
                        <input type="hidden" name="customerId" value={row.id} />
                        <s-stack direction="inline" gap="small">
                          <s-select name="ruleHandle" label="Reward">
                            {data.manualRules.map((rule) => (
                              <s-option key={rule.handle} value={rule.handle}>
                                {rule.title}
                                {rule.pointsValue ? ` (+${rule.pointsValue})` : ''}
                              </s-option>
                            ))}
                          </s-select>
                          <s-button variant="secondary" type="submit">Award</s-button>
                        </s-stack>
                      </Form>
                    ) : (
                      <s-text>—</s-text>
                    )}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}

        <s-stack direction="inline" gap="base">
          {currentCursor ? (
            <Link to="/app/customers">
              <s-button variant="secondary">First page</s-button>
            </Link>
          ) : null}
          {data.cursor ? (
            <Link to={`/app/customers?after=${encodeURIComponent(data.cursor)}`}>
              <s-button variant="primary">Next page</s-button>
            </Link>
          ) : null}
        </s-stack>
      </s-section>

      <s-section heading="Referral reconciliation">
        <s-paragraph>
          Re-attempt referral credit for customers whose referrer was not
          credited due to a transient failure during their first order.
        </s-paragraph>

        {reconcileResult ? (
          <s-banner
            tone={reconcileResult.failed.length > 0 ? 'warning' : 'success'}
            heading={
              reconcileResult.attempted === 0
                ? 'No pending referrals found'
                : `Reconciled ${reconcileResult.succeeded} of ${reconcileResult.attempted}`
            }
          >
            {reconcileResult.failed.length > 0 ? (
              <s-paragraph>
                Failed: {reconcileResult.failed.map((f) => f.refereeId).join(', ')}
              </s-paragraph>
            ) : null}
          </s-banner>
        ) : null}

        <Form method="post">
          <input type="hidden" name="intent" value="reconcile" />
          <s-button
            variant="secondary"
            type="submit"
            disabled={isReconciling || undefined}
          >
            {isReconciling ? 'Reconciling…' : 'Reconcile pending referrals'}
          </s-button>
        </Form>
      </s-section>
    </s-page>
  );
}

function formatCurrency(amount: number, currencyCode: string) {
  try {
    return new Intl.NumberFormat('en-US', {
      currency: currencyCode,
      style: 'currency',
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currencyCode}`;
  }
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
