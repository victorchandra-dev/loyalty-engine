import {describe, it, expect, vi} from 'vitest';
import {fakeAdmin, okWrite} from '../helpers/fakes.js';

vi.mock('../../../app/session-storage.server', () => ({prisma: {}}));

const {saveEarnRuleConfiguration, saveRedemptionConfiguration} = await import(
  '../../../app/loyalty/earn-rules-redemptions-admin.server'
);

const nodes = {nodes: []};
const definition = (type: string) => ({
  id: `gid://shopify/MetaobjectDefinition/${type}`,
  name: type,
  type,
  displayNameKey: 'title',
  access: {admin: 'MERCHANT_READ', storefront: 'PUBLIC_READ'},
  fieldDefinitions: [{key: 'title', name: 'Title', type: {name: 'single_line_text_field'}}],
});

// An older store: the earn rule and redemption definitions exist but lack newer fields.
const olderStore = () =>
  fakeAdmin({
    LoyaltyMetafieldDefinition: () => ({
      metafieldDefinition: {id: 'gid://shopify/MetafieldDefinition/1', access: {customerAccount: 'READ', storefront: 'PUBLIC_READ'}},
    }),
    LoyaltyProgramAdminState: () => ({
      shop: {id: 'gid://shopify/Shop/1', currencyCode: 'USD', tierDiscounts: null},
      tierDefinition: null,
      benefitDefinition: null,
      earnRuleDefinition: definition('loyalty_earn_rule'),
      redemptionDefinition: definition('loyalty_redemption'),
      tierDefinitions: nodes,
      benefitDefinitions: nodes,
      earnRuleEntries: nodes,
      redemptionEntries: nodes,
    }),
    LoyaltyMetaobjectDefinitionCreate: () => ({metaobjectDefinitionCreate: {userErrors: []}}),
    LoyaltyMetaobjectDefinitionUpdate: () => ({metaobjectDefinitionUpdate: {userErrors: []}}),
    LoyaltyMetaobjectUpsert: () => ({metaobjectUpsert: {userErrors: []}}),
    LoyaltyProgramEnabled: () => ({shop: {id: 'gid://shopify/Shop/1', myshopifyDomain: 'a.myshopify.com', programEnabled: null}}),
    LoyaltyDisplaySettings: () => ({shop: {id: 'gid://shopify/Shop/1', myshopifyDomain: 'a.myshopify.com', displaySettings: null}}),
    LoyaltyMetafieldsSet: okWrite,
  });

describe('saving earn rules and rewards on an older store', () => {
  it('adds the missing definition fields before writing earn rules', async () => {
    const shopify = olderStore();
    await saveEarnRuleConfiguration({
      admin: shopify.admin as never,
      earnRules: [{title: 'Order', description: '', action: 'order', pointsValue: null, active: true, repeatable: true}],
    });

    const names = shopify.calls.map((c) => c.name);
    const update = shopify.calls.find(
      (c) => c.name === 'LoyaltyMetaobjectDefinitionUpdate' && c.variables.id === 'gid://shopify/MetaobjectDefinition/loyalty_earn_rule',
    );
    const added = (update?.variables.definition as {fieldDefinitions: Array<{create: {key: string}}>}).fieldDefinitions.map((f) => f.create.key);
    expect(added).toContain('repeatable');
    expect(names.indexOf('LoyaltyMetaobjectDefinitionUpdate')).toBeLessThan(names.indexOf('LoyaltyMetaobjectUpsert'));
  });

  it('does the same before writing rewards', async () => {
    const shopify = olderStore();
    await saveRedemptionConfiguration({
      admin: shopify.admin as never,
      redemptions: [{title: 'Gift', description: '', pointsCost: 100, rewardType: 'fixed_amount', rewardValue: '5', active: true}],
    });

    const names = shopify.calls.map((c) => c.name);
    expect(names).toContain('LoyaltyMetaobjectDefinitionUpdate');
    expect(names.indexOf('LoyaltyMetaobjectDefinitionUpdate')).toBeLessThan(names.indexOf('LoyaltyMetaobjectUpsert'));
  });
});
