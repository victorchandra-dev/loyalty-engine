/**
 * What the admin shows while "Sync customers" runs page by page, and when it
 * ends. Written for the store owner, not a developer.
 */
export function describeCustomerSync({
  synced,
  failed,
  nextCursor,
}: {
  synced: number;
  failed: number;
  nextCursor: string | null;
}): {status: 'success' | 'error'; message: string} {
  if (nextCursor) {
    return {
      status: 'success',
      message: `Syncing customers… ${synced} done so far. Keep this page open until it finishes.`,
    };
  }
  if (failed > 0) {
    return {
      status: 'error',
      message: `${synced} customers are up to date. ${failed} couldn't be read right now and were left as they were. Click “Sync customers” again to retry them.`,
    };
  }
  return {status: 'success', message: `All ${synced} customers are up to date.`};
}
