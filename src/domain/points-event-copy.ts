/**
 * Plain wording for one points-history row, as staff see it on the customer
 * page. All English strings for history rows live here, so the
 * English + Indonesian slice only swaps this switch.
 */
export function describePointsEvent(event: {
  type: string;
  orderId: string | null;
  data: unknown;
}): {text: string; orderNumber: string | null} {
  const data = event.data && typeof event.data === 'object' ? (event.data as Record<string, unknown>) : {};
  const str = (key: string) => (typeof data[key] === 'string' && data[key] !== '' ? (data[key] as string) : null);
  const title = str('title');
  const code = str('code');

  let text: string;
  switch (event.type) {
    case 'order': text = 'Earned from order'; break;
    case 'signup': text = 'Sign-up bonus'; break;
    case 'referral': text = 'Referral bonus'; break;
    case 'refund': text = 'Taken back after a refund'; break;
    case 'redeem': text = title ? `Redeemed for ${title}${code ? ` (code ${code})` : ''}` : 'Redeemed for a reward'; break;
    case 'reward_used': text = code ? `Used reward code ${code}` : 'Used a reward code'; break;
    case 'manual': text = title ? `Awarded for ${title}` : 'Awarded points'; break;
    case 'adjust': {
      const reason = str('reason');
      text = `Adjusted by ${str('staffName') ?? 'staff'}${reason ? `: ${reason}` : ''}`;
      break;
    }
    default: text = 'Points changed';
  }

  const orderNumber = /^gid:\/\/shopify\/Order\/(\d+)$/.exec(event.orderId ?? '')?.[1] ?? null;
  return {text, orderNumber};
}
