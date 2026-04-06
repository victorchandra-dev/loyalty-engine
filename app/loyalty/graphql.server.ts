import type {AdminApiContext} from '@shopify/shopify-app-react-router/server';

type GraphqlEnvelope<T> = {
  data?: T;
  errors?: Array<{
    message?: string;
  }>;
};

type MutationUserError = {
  field?: Array<string | number> | null;
  message: string;
};

export async function adminGraphql<TData>(
  admin: AdminApiContext,
  query: string,
  variables?: Record<string, unknown>,
) {
  const response = await admin.graphql(
    query,
    variables ? {variables} : undefined,
  );
  const json = (await response.json()) as GraphqlEnvelope<TData>;

  if (!response.ok) {
    throw new Error(
      `Admin GraphQL request failed with status ${response.status}.`,
    );
  }

  if (json.errors?.length) {
    const messages = json.errors
      .map((error) => error.message?.trim())
      .filter(Boolean)
      .join(' | ');

    throw new Error(messages || 'Admin GraphQL request returned errors.');
  }

  if (!json.data) {
    throw new Error('Admin GraphQL request returned no data.');
  }

  return json.data;
}

export function assertNoUserErrors(
  errors: MutationUserError[] | undefined,
  label: string,
) {
  if (!errors?.length) {
    return;
  }

  const message = errors
    .map((error) => {
      const fieldPath = error.field?.length
        ? ` (${error.field.join('.')})`
        : '';
      return `${error.message}${fieldPath}`;
    })
    .join(' | ');

  throw new Error(`${label}: ${message}`);
}
