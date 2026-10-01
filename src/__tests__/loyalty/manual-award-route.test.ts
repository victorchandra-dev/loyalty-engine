import {describe, it, expect, vi} from 'vitest';
import {customerResponse, fakeAdmin, memoryPrisma, okWrite, testProgram} from '../helpers/fakes.js';

const prisma = memoryPrisma();
vi.mock('../../../app/session-storage.server', () => ({prisma}));

const {awardEarnRuleToCustomer} = await import('../../../app/loyalty/customer-state.server');

describe('awardEarnRuleToCustomer', () => {
  it('records the manually awarded points in the history', async () => {
    const program = {
      ...testProgram,
      earnRules: [
        ...testProgram.earnRules,
        {id: 'b', handle: 'birthday', title: 'Birthday', description: null, action: 'birthday', pointsValue: 100, active: true, repeatable: false},
      ],
    };
    const shopify = fakeAdmin({
      LoyaltyCustomer: () => customerResponse({balance: 250}),
      LoyaltyMetafieldsSet: okWrite,
    });

    const result = await awardEarnRuleToCustomer({
      admin: shopify.admin as never,
      shop: 'test.myshopify.com',
      customerAdminId: 'gid://shopify/Customer/1',
      ruleHandle: 'birthday',
      program,
    });

    expect(result.status).toBe('awarded');
    expect(prisma.events).toEqual([
      {
        shop: 'test.myshopify.com', customerId: 'gid://shopify/Customer/1', type: 'manual', points: 100, balance: 350,
        data: {rule: 'birthday', title: 'Birthday'},
      },
    ]);
  });
});
