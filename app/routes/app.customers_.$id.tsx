import {useEffect, useRef, useState, type FormEvent} from 'react';
import type {ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs} from 'react-router';
import {Form, Link, useActionData, useLoaderData} from 'react-router';
import {boundary} from '@shopify/shopify-app-react-router/server';
import {describePointsEvent} from '../../src/domain/points-event-copy.js';
import {adjustCustomerPoints, type AdjustOutcome} from '../loyalty/customer-state.server';
import {adminGraphql} from '../loyalty/graphql.server';
import {listPointsEvents} from '../loyalty/points-history.server';
import {fetchLoyaltyProgramConfiguration} from '../loyalty/program.server';
import {authenticate} from '../shopify.server';

const STAFF_NAME_KEY = 'loyalty.staffName';

const fmt = (n: number) => n.toLocaleString('en-US');
const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : fmt(n));

// All strings on this page; the English + Indonesian slice swaps this object.
const COPY = {
  back: 'Customers',
  points: 'Points',
  tier: 'Tier',
  noTier: 'No tier',
  adjustHeading: 'Adjust points',
  adjustHelp: 'Add or remove points by hand. The customer sees the new balance right away.',
  direction: 'Add or remove',
  add: 'Add points',
  remove: 'Remove points',
  amount: 'Points',
  staffName: 'Your name',
  reason: 'Reason',
  save: 'Save',
  historyHeading: 'Points history',
  empty: 'No points activity yet.',
  columns: {date: 'Date', what: 'What happened', points: 'Points', balance: 'Balance after'},
  viewOrder: 'View order',
  newest: 'Newest',
  older: 'Older',
  outcome(outcome: AdjustOutcome): string {
    switch (outcome.status) {
      case 'adjusted':
        return `${outcome.delta > 0 ? 'Added' : 'Removed'} ${fmt(Math.abs(outcome.delta))} points. Balance: ${fmt(outcome.balance)}.`;
      case 'below_zero':
        return `They have ${fmt(outcome.balance)} points. You can remove up to ${fmt(outcome.balance)}.`;
      case 'invalid':
        return 'Enter a whole number of points (1 or more), your name and a reason.';
      case 'no_program':
        return 'Initialize the program first.';
      case 'not_found':
        return 'Customer not found.';
      case 'conflict':
        return 'Their points changed while you were editing. Reload and try again.';
      case 'failed':
        return 'Could not change points right now. Please try again.';
    }
  },
};

const CUSTOMER_HEADER_QUERY = `#graphql
  query LoyaltyCustomerHeader($id: ID!) {
    shop {
      ianaTimezone
    }
    customer(id: $id) {
      id
      displayName
      defaultEmailAddress {
        emailAddress
      }
      balance: metafield(namespace: "$app", key: "loyalty_points_balance") {
        value
      }
      state: metafield(namespace: "$app", key: "loyalty_state") {
        value
      }
    }
  }
` as const;

type CustomerHeaderData = {
  shop: {ianaTimezone: string};
  customer: {
    id: string;
    displayName: string;
    defaultEmailAddress: {emailAddress: string | null} | null;
    balance: {value: string | null} | null;
    state: {value: string | null} | null;
  } | null;
};

function toCustomerGid(id: string | undefined) {
  return id && /^\d+$/.test(id) ? `gid://shopify/Customer/${id}` : null;
}

function notFound(): never {
  throw new Response('Not found', {status: 404});
}

export const loader = async ({request, params}: LoaderFunctionArgs) => {
  const {admin, session} = await authenticate.admin(request);
  const customerId = toCustomerGid(params.id) ?? notFound();
  const after = new URL(request.url).searchParams.get('after');

  const [header, configuration, history] = await Promise.all([
    adminGraphql<CustomerHeaderData>(admin, CUSTOMER_HEADER_QUERY, {id: customerId}),
    fetchLoyaltyProgramConfiguration(admin),
    listPointsEvents(session.shop, customerId, after),
  ]);
  const customer = header.customer ?? notFound();

  let tierHandle: string | null = null;
  try {
    tierHandle = (JSON.parse(customer.state?.value ?? 'null') as {currentTierHandle?: string | null} | null)?.currentTierHandle ?? null;
  } catch {
    // unreadable state: show as no tier
  }
  const tier = configuration.syncPlan.program?.tiers.find((entry) => entry.handle === tierHandle)?.name ?? tierHandle;
  const balance = Number.parseInt(customer.balance?.value ?? '0', 10);
  const date = new Intl.DateTimeFormat('en-US', {dateStyle: 'medium', timeStyle: 'short', timeZone: header.shop.ianaTimezone});

  return {
    numericId: params.id as string,
    name: customer.displayName,
    email: customer.defaultEmailAddress?.emailAddress ?? '—',
    balance: Number.isFinite(balance) ? balance : 0,
    tier,
    events: history.rows.map((row) => ({
      id: row.id,
      date: date.format(row.createdAt),
      points: row.points,
      balance: row.balance,
      ...describePointsEvent(row),
    })),
    nextCursor: history.nextCursor,
    isLaterPage: Boolean(after),
  };
};

export const action = async ({request, params}: ActionFunctionArgs) => {
  const {admin, session, sessionToken} = await authenticate.admin(request);
  const customerId = toCustomerGid(params.id) ?? notFound();
  const form = await request.formData();

  const program = (await fetchLoyaltyProgramConfiguration(admin)).syncPlan.program;
  if (!program) return {outcome: {status: 'no_program'} as AdjustOutcome};

  const points = Number(form.get('points'));
  const outcome = await adjustCustomerPoints({
    admin,
    shop: session.shop,
    customerAdminId: customerId,
    program,
    delta: form.get('direction') === 'remove' ? -points : points,
    staffName: String(form.get('staffName') ?? ''),
    reason: String(form.get('reason') ?? ''),
    staffUserId: sessionToken?.sub ? String(sessionToken.sub) : null,
  });
  return {outcome};
};

export default function CustomerRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const outcome = actionData?.outcome;
  const formRef = useRef<HTMLFormElement>(null);
  const [savedName, setSavedName] = useState('');

  useEffect(() => {
    try {
      setSavedName(localStorage.getItem(STAFF_NAME_KEY) ?? '');
    } catch {
      // storage blocked: the field just starts empty
    }
  }, []);

  // Clear the form after a successful change so a second click can't repeat it.
  useEffect(() => {
    if (actionData?.outcome.status === 'adjusted') formRef.current?.reset();
  }, [actionData]);

  const rememberName = (event: FormEvent<HTMLFormElement>) => {
    const name = new FormData(event.currentTarget).get('staffName');
    if (typeof name !== 'string' || !name.trim()) return;
    try {
      localStorage.setItem(STAFF_NAME_KEY, name.trim());
    } catch {
      // storage blocked: nothing to remember
    }
    setSavedName(name.trim());
  };

  return (
    <s-page heading={data.name}>
      <s-link slot="breadcrumb-actions" href="/app/customers">{COPY.back}</s-link>

      <s-section>
        <s-stack direction="inline" gap="large">
          <s-text>{data.email}</s-text>
          <s-text>{COPY.points}: <s-text type="strong">{fmt(data.balance)}</s-text></s-text>
          <s-text>{COPY.tier}: <s-text type="strong">{data.tier ?? COPY.noTier}</s-text></s-text>
        </s-stack>
      </s-section>

      <s-section heading={COPY.adjustHeading}>
        <s-paragraph>{COPY.adjustHelp}</s-paragraph>
        {outcome ? (
          <s-banner tone={outcome.status === 'adjusted' ? 'success' : 'critical'}>
            <s-paragraph>{COPY.outcome(outcome)}</s-paragraph>
          </s-banner>
        ) : null}
        <Form method="post" ref={formRef} onSubmit={rememberName}>
          <s-stack direction="block" gap="base">
            <s-grid gridTemplateColumns="1fr 1fr" gap="base">
              <s-select label={COPY.direction} name="direction">
                <s-option value="add">{COPY.add}</s-option>
                <s-option value="remove">{COPY.remove}</s-option>
              </s-select>
              <s-number-field label={COPY.amount} name="points" min={1} step={1} inputMode="numeric" required></s-number-field>
            </s-grid>
            <s-text-field key={savedName} label={COPY.staffName} name="staffName" defaultValue={savedName} maxLength={60} required></s-text-field>
            <s-text-area label={COPY.reason} name="reason" rows={2} maxLength={200} required></s-text-area>
            <s-button variant="primary" type="submit">{COPY.save}</s-button>
          </s-stack>
        </Form>
      </s-section>

      <s-section heading={COPY.historyHeading}>
        {data.events.length === 0 ? (
          <s-paragraph>{COPY.empty}</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>{COPY.columns.date}</s-table-header>
              <s-table-header listSlot="primary">{COPY.columns.what}</s-table-header>
              <s-table-header format="numeric">{COPY.columns.points}</s-table-header>
              <s-table-header format="numeric">{COPY.columns.balance}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.events.map((event) => (
                <s-table-row key={event.id}>
                  <s-table-cell>{event.date}</s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small">
                      <s-text>{event.text}</s-text>
                      {event.orderNumber ? (
                        <s-link href={`shopify://admin/orders/${event.orderNumber}`}>{COPY.viewOrder}</s-link>
                      ) : null}
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>{signed(event.points)}</s-table-cell>
                  <s-table-cell>{fmt(event.balance)}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
        <s-stack direction="inline" gap="base">
          {data.isLaterPage ? (
            <Link to={`/app/customers/${data.numericId}`}>
              <s-button variant="secondary">{COPY.newest}</s-button>
            </Link>
          ) : null}
          {data.nextCursor ? (
            <Link to={`/app/customers/${data.numericId}?after=${encodeURIComponent(data.nextCursor)}`}>
              <s-button variant="secondary">{COPY.older}</s-button>
            </Link>
          ) : null}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
