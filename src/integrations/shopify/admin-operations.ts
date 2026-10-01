export const CUSTOMERS_PAGE_QUERY = `#graphql
  query LoyaltyCustomersPage($first: Int!, $after: String) {
    customers(first: $first, after: $after, sortKey: ID) {
      nodes {
        id
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
      tierDiscounts: metafield(namespace: "$app", key: "loyalty_tier_discounts") {
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

export const TIER_DISCOUNT_STATE_QUERY = `#graphql
  query LoyaltyTierDiscountState {
    shop {
      id
      tierDiscounts: metafield(namespace: "$app", key: "loyalty_tier_discounts") {
        value
      }
      legacyDiscount: metafield(namespace: "$app", key: "loyalty_discount_id") {
        value
      }
    }
  }
` as const;

export const NODES_EXIST_QUERY = `#graphql
  query LoyaltyNodesExist($ids: [ID!]!) {
    nodes(ids: $ids) {
      id
    }
  }
` as const;

export const SEGMENT_CREATE_MUTATION = `#graphql
  mutation LoyaltySegmentCreate($name: String!, $query: String!) {
    segmentCreate(name: $name, query: $query) {
      segment {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
` as const;

export const SEGMENT_UPDATE_MUTATION = `#graphql
  mutation LoyaltySegmentUpdate($id: ID!, $name: String, $query: String) {
    segmentUpdate(id: $id, name: $name, query: $query) {
      segment {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
` as const;

export const SEGMENT_DELETE_MUTATION = `#graphql
  mutation LoyaltySegmentDelete($id: ID!) {
    segmentDelete(id: $id) {
      deletedSegmentId
      userErrors {
        field
        message
      }
    }
  }
` as const;

export const TIER_DISCOUNT_CREATE_MUTATION = `#graphql
  mutation LoyaltyTierDiscountCreate($discount: DiscountAutomaticBasicInput!) {
    discountAutomaticBasicCreate(automaticBasicDiscount: $discount) {
      automaticDiscountNode {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
` as const;

export const TIER_DISCOUNT_UPDATE_MUTATION = `#graphql
  mutation LoyaltyTierDiscountUpdate($id: ID!, $discount: DiscountAutomaticBasicInput!) {
    discountAutomaticBasicUpdate(id: $id, automaticBasicDiscount: $discount) {
      automaticDiscountNode {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
` as const;

export const AUTOMATIC_DISCOUNT_DELETE_MUTATION = `#graphql
  mutation LoyaltyAutomaticDiscountDelete($id: ID!) {
    discountAutomaticDelete(id: $id) {
      deletedAutomaticDiscountId
      userErrors {
        field
        message
      }
    }
  }
` as const;

export const METAFIELDS_DELETE_MUTATION = `#graphql
  mutation LoyaltyMetafieldsDelete($metafields: [MetafieldIdentifierInput!]!) {
    metafieldsDelete(metafields: $metafields) {
      deletedMetafields {
        key
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
