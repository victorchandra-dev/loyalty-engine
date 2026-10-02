import {describe, it, expect} from 'vitest';
import {fakeAdmin} from '../helpers/fakes.js';

const {ensureStorefrontReadableDefinitions} = await import('../../../app/loyalty/admin.server');

const created = () => ({metafieldDefinitionCreate: {createdDefinition: {id: 'gid://shopify/MetafieldDefinition/1'}, userErrors: []}});
const updated = () => ({metafieldDefinitionUpdate: {updatedDefinition: {id: 'gid://shopify/MetafieldDefinition/1'}, userErrors: []}});

describe('ensureStorefrontReadableDefinitions', () => {
  it('creates the definitions the storefront reads when the store has none (live store, 2 Oct)', async () => {
    const shopify = fakeAdmin({
      LoyaltyMetafieldDefinition: () => ({metafieldDefinition: null}),
      LoyaltyMetafieldDefinitionCreate: created,
    });

    await ensureStorefrontReadableDefinitions(shopify.admin as never);

    const definitions = shopify.calls
      .filter((c) => c.name === 'LoyaltyMetafieldDefinitionCreate')
      .map((c) => c.variables.definition as Record<string, unknown>);
    expect(definitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ownerType: 'CUSTOMER', namespace: '$app', key: 'loyalty_points_balance', type: 'number_integer', access: {admin: 'MERCHANT_READ', customerAccount: 'READ'}}),
        expect.objectContaining({ownerType: 'CUSTOMER', namespace: '$app', key: 'loyalty_state', type: 'json', access: {admin: 'MERCHANT_READ', customerAccount: 'READ'}}),
        expect.objectContaining({ownerType: 'CUSTOMER', namespace: '$app', key: 'loyalty_active_redemption', type: 'json', access: {admin: 'MERCHANT_READ', customerAccount: 'READ'}}),
        expect.objectContaining({ownerType: 'SHOP', namespace: '$app', key: 'loyalty_display_settings', type: 'json', access: {admin: 'MERCHANT_READ', storefront: 'PUBLIC_READ'}}),
      ]),
    );
    expect(definitions).toHaveLength(4);
  });

  it('leaves correct definitions alone and fixes one whose access is wrong', async () => {
    const shopify = fakeAdmin({
      LoyaltyMetafieldDefinition: ({identifier}) =>
        (identifier as {key: string}).key === 'loyalty_state'
          ? {metafieldDefinition: {id: 'gid://shopify/MetafieldDefinition/9', access: {customerAccount: 'NONE', storefront: 'NONE'}}}
          : {metafieldDefinition: {id: 'gid://shopify/MetafieldDefinition/8', access: {customerAccount: 'READ', storefront: 'PUBLIC_READ'}}},
      LoyaltyMetafieldDefinitionUpdate: updated,
    });

    await ensureStorefrontReadableDefinitions(shopify.admin as never);

    expect(shopify.calls.some((c) => c.name === 'LoyaltyMetafieldDefinitionCreate')).toBe(false);
    const updates = shopify.calls.filter((c) => c.name === 'LoyaltyMetafieldDefinitionUpdate');
    expect(updates).toHaveLength(1);
    expect(updates[0].variables.definition).toMatchObject({ownerType: 'CUSTOMER', namespace: '$app', key: 'loyalty_state', access: {customerAccount: 'READ'}});
  });
});
