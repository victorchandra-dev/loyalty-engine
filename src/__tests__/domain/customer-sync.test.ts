import {describe, it, expect} from 'vitest';
import {describeCustomerSync} from '../../domain/customer-sync.js';

describe('describeCustomerSync', () => {
  it('asks to keep the page open while more pages are coming', () => {
    expect(describeCustomerSync({synced: 40, failed: 0, nextCursor: 'c3'})).toEqual({
      status: 'success',
      message: 'Syncing customers… 40 done so far. Keep this page open until it finishes.',
    });
  });

  it('says everyone is up to date when the last page is done', () => {
    expect(describeCustomerSync({synced: 1234, failed: 0, nextCursor: null})).toEqual({
      status: 'success',
      message: 'All 1234 customers are up to date.',
    });
  });

  it('says how many were skipped and what to do about it', () => {
    expect(describeCustomerSync({synced: 1230, failed: 4, nextCursor: null})).toEqual({
      status: 'error',
      message:
        "1230 customers are up to date. 4 couldn't be read right now and were left as they were. Click “Sync customers” again to retry them.",
    });
  });
});
