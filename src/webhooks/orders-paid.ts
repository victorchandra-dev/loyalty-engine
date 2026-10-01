export type OrdersPaidWebhookPayload = {
  id?: number | null;
  admin_graphql_api_id?: string | null;
  admin_graphql_api_customer_id?: string | null;
  current_total_price?: string | null;
  discount_codes?: Array<{code?: string | null}> | null;
  customer?: {
    id?: number | null;
  } | null;
};

export function getOrdersPaidOrderGid(
  payload: OrdersPaidWebhookPayload,
): string | null {
  if (payload.admin_graphql_api_id) return payload.admin_graphql_api_id;
  if (payload.id) return `gid://shopify/Order/${payload.id}`;
  return null;
}

export function getOrdersPaidCustomerAdminId(
  payload: OrdersPaidWebhookPayload,
) {
  if (payload.admin_graphql_api_customer_id) {
    return payload.admin_graphql_api_customer_id;
  }

  if (payload.customer?.id) {
    return `gid://shopify/Customer/${payload.customer.id}`;
  }

  return null;
}

export function getOrdersPaidOrderAmount(payload: OrdersPaidWebhookPayload) {
  const raw = payload.current_total_price;
  if (!raw) return 0;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** Discount codes the order used (reward codes are matched against these). */
export function getOrdersPaidDiscountCodes(payload: OrdersPaidWebhookPayload) {
  return (payload.discount_codes ?? []).flatMap((entry) => (entry.code ? [entry.code] : []));
}
