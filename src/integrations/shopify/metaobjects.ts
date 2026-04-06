import type {MerchantMetaobjectEntry} from '../../domain/program.js';

export type ShopifyMetaobjectNode = {
  id: string;
  handle: string;
  type: string;
  fields: Array<{
    key: string;
    value: string | null;
  }>;
};

export function toMerchantMetaobjectEntry(
  node: ShopifyMetaobjectNode,
): MerchantMetaobjectEntry {
  return {
    id: node.id,
    handle: node.handle,
    type: node.type,
    fields: Object.fromEntries(
      node.fields.map((field) => [field.key, field.value]),
    ),
  };
}
