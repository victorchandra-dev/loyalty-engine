export const CUSTOMER_SPEND_QUERY = `#graphql
  query LoyaltyCustomerSpend($id: ID!) {
    customer(id: $id) {
      id
      amountSpent {
        amount
        currencyCode
      }
      numberOfOrders
    }
  }
` as const;

export const CUSTOMERS_PAGE_QUERY = `#graphql
  query LoyaltyCustomersPage($first: Int!, $after: String) {
    customers(first: $first, after: $after, sortKey: ID) {
      nodes {
        id
        amountSpent {
          amount
          currencyCode
        }
        numberOfOrders
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
` as const;

export const METAFIELDS_SET_MUTATION = `#graphql
  mutation LoyaltyMetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
        namespace
        key
      }
      userErrors {
        field
        message
      }
    }
  }
` as const;

// The metaobject `type:` literals below MUST match `LOYALTY_METAOBJECT_TYPES`
// in ../../domain/program.ts (the single source of truth, audit M4). They are
// inlined here because they are part of a static GraphQL document string and
// cannot be interpolated from a const without losing codegen support.
export const LOYALTY_PROGRAM_ADMIN_QUERY = `#graphql
  query LoyaltyProgramAdminState {
    shop {
      id
      currencyCode
      discountId: metafield(namespace: "$app", key: "loyalty_discount_id") {
        value
      }
    }
    tierDefinition: metaobjectDefinitionByType(type: "loyalty_reward_tier") {
      id
      name
      type
      displayNameKey
      access {
        admin
        storefront
      }
      fieldDefinitions {
        key
        name
        type {
          name
        }
      }
    }
    benefitDefinition: metaobjectDefinitionByType(type: "loyalty_reward_benefit") {
      id
      name
      type
      displayNameKey
      access {
        admin
        storefront
      }
      fieldDefinitions {
        key
        name
        type {
          name
        }
      }
    }
    earnRuleDefinition: metaobjectDefinitionByType(type: "loyalty_earn_rule") {
      id
      name
      type
      displayNameKey
      access {
        admin
        storefront
      }
      fieldDefinitions {
        key
        name
        type {
          name
        }
      }
    }
    redemptionDefinition: metaobjectDefinitionByType(type: "loyalty_redemption") {
      id
      name
      type
      displayNameKey
      access {
        admin
        storefront
      }
      fieldDefinitions {
        key
        name
        type {
          name
        }
      }
    }
    tierDefinitions: metaobjects(type: "loyalty_reward_tier", first: 100) {
      nodes {
        id
        handle
        type
        fields {
          key
          value
        }
      }
    }
    benefitDefinitions: metaobjects(type: "loyalty_reward_benefit", first: 100) {
      nodes {
        id
        handle
        type
        fields {
          key
          value
        }
      }
    }
    earnRuleEntries: metaobjects(type: "loyalty_earn_rule", first: 100) {
      nodes {
        id
        handle
        type
        fields {
          key
          value
        }
      }
    }
    redemptionEntries: metaobjects(type: "loyalty_redemption", first: 100) {
      nodes {
        id
        handle
        type
        fields {
          key
          value
        }
      }
    }
  }
` as const;

export const DISCOUNT_AUTOMATIC_APP_CREATE_MUTATION = `#graphql
  mutation LoyaltyAutomaticDiscountCreate($automaticAppDiscount: DiscountAutomaticAppInput!) {
    discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) {
      automaticAppDiscount {
        discountId
        title
        status
      }
      userErrors {
        field
        message
      }
    }
  }
` as const;

export const DISCOUNT_AUTOMATIC_APP_UPDATE_MUTATION = `#graphql
  mutation LoyaltyAutomaticDiscountUpdate($id: ID!, $automaticAppDiscount: DiscountAutomaticAppInput!) {
    discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $automaticAppDiscount) {
      automaticAppDiscount {
        discountId
        title
        status
      }
      userErrors {
        field
        message
      }
    }
  }
` as const;

export const METAOBJECT_DEFINITION_CREATE_MUTATION = `#graphql
  mutation LoyaltyMetaobjectDefinitionCreate($definition: MetaobjectDefinitionCreateInput!) {
    metaobjectDefinitionCreate(definition: $definition) {
      metaobjectDefinition {
        id
        name
        type
        displayNameKey
        fieldDefinitions {
          key
          name
          type {
            name
          }
        }
      }
      userErrors {
        field
        message
        code
      }
    }
  }
` as const;

export const METAOBJECT_DEFINITION_UPDATE_MUTATION = `#graphql
  mutation LoyaltyMetaobjectDefinitionUpdate($id: ID!, $definition: MetaobjectDefinitionUpdateInput!) {
    metaobjectDefinitionUpdate(id: $id, definition: $definition) {
      metaobjectDefinition {
        id
        name
        type
        displayNameKey
        fieldDefinitions {
          key
          name
          type {
            name
          }
        }
      }
      userErrors {
        field
        message
        code
      }
    }
  }
` as const;

export const METAOBJECT_UPSERT_MUTATION = `#graphql
  mutation LoyaltyMetaobjectUpsert($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
    metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
      metaobject {
        id
        handle
      }
      userErrors {
        field
        message
        code
      }
    }
  }
` as const;

export const METAOBJECT_DELETE_MUTATION = `#graphql
  mutation LoyaltyMetaobjectDelete($id: ID!) {
    metaobjectDelete(id: $id) {
      deletedId
      userErrors {
        field
        message
        code
      }
    }
  }
` as const;

export const METAFIELD_DEFINITION_BY_KEY_QUERY = `#graphql
  query LoyaltyMetafieldDefinitionByKey(
    $namespace: String!
    $key: String!
    $ownerType: MetafieldOwnerType!
  ) {
    metafieldDefinitions(
      first: 1
      namespace: $namespace
      key: $key
      ownerType: $ownerType
    ) {
      nodes {
        id
        namespace
        key
        access {
          customerAccount
        }
      }
    }
  }
` as const;

export const METAFIELD_DEFINITION_CREATE_MUTATION = `#graphql
  mutation LoyaltyMetafieldDefinitionCreate($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition {
        id
        namespace
        key
      }
      userErrors {
        field
        message
        code
      }
    }
  }
` as const;

export const METAFIELD_DEFINITION_UPDATE_MUTATION = `#graphql
  mutation LoyaltyMetafieldDefinitionUpdate(
    $definition: MetafieldDefinitionUpdateInput!
  ) {
    metafieldDefinitionUpdate(definition: $definition) {
      updatedDefinition {
        id
        namespace
        key
        access {
          customerAccount
        }
      }
      userErrors {
        field
        message
        code
      }
    }
  }
` as const;
