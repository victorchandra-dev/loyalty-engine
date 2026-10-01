import type {AdminApiContext} from '@shopify/shopify-app-react-router/server';
import {METAFIELDS_SET_MUTATION} from '../../src/integrations/shopify/admin-operations.js';
import {
  APP_METAFIELD_NAMESPACE,
  SHOP_LOYALTY_DISPLAY_SETTINGS_KEY,
  SHOP_LOYALTY_PROGRAM_ENABLED_KEY,
} from './constants';
import {adminGraphql, assertNoUserErrors} from './graphql.server';

export type LoyaltyDisplaySettings = {
  launcherEnabled: boolean;
  hydrogenEnabled: boolean;
  widgetTitle: string;
  widgetIntro: string;
  pointsLabel: string;
  primaryColor: string;
  accentColor: string;
  launcherPosition: 'bottom-left' | 'bottom-right';
};

export const DEFAULT_LOYALTY_DISPLAY_SETTINGS: LoyaltyDisplaySettings = {
  launcherEnabled: true,
  hydrogenEnabled: true,
  widgetTitle: 'Rewards',
  widgetIntro: 'Earn points, unlock tiers, and redeem rewards at checkout.',
  pointsLabel: 'points',
  primaryColor: '#202223',
  accentColor: '#008060',
  launcherPosition: 'bottom-right',
};

const PROGRAM_ENABLED_QUERY = `#graphql
  query LoyaltyProgramEnabled {
    shop {
      id
      myshopifyDomain
      programEnabled: metafield(
        namespace: "$app"
        key: "loyalty_program_enabled"
      ) {
        value
      }
    }
  }
` as const;

type ProgramEnabledData = {
  shop: {
    id: string;
    myshopifyDomain?: string | null;
    programEnabled: {value: string | null} | null;
  };
};

const DISPLAY_SETTINGS_QUERY = `#graphql
  query LoyaltyDisplaySettings {
    shop {
      id
      myshopifyDomain
      displaySettings: metafield(
        namespace: "$app"
        key: "loyalty_display_settings"
      ) {
        value
      }
    }
  }
` as const;

type DisplaySettingsData = {
  shop: {
    id: string;
    myshopifyDomain?: string | null;
    displaySettings: {value: string | null} | null;
  };
};

type MetafieldsSetMutationData = {
  metafieldsSet: {
    userErrors: Array<{
      field?: Array<string | number> | null;
      message: string;
    }>;
  };
};

/**
 * Read the program-enabled flag. The metafield holds the literal string
 * "true" or "false". Default to enabled (`true`) when the metafield is unset
 * — that's the legacy behaviour for shops that pre-date this toggle.
 */
export async function fetchProgramEnabled(
  admin: AdminApiContext,
): Promise<{shopId: string; shopDomain: string | null; enabled: boolean}> {
  const data = await adminGraphql<ProgramEnabledData>(
    admin,
    PROGRAM_ENABLED_QUERY,
  );
  const raw = data.shop.programEnabled?.value;
  return {
    shopId: data.shop.id,
    shopDomain: data.shop.myshopifyDomain ?? null,
    enabled: raw === null || raw === undefined ? true : raw !== 'false',
  };
}

export async function setProgramEnabled(
  admin: AdminApiContext,
  shopId: string,
  enabled: boolean,
): Promise<void> {
  const result = await adminGraphql<MetafieldsSetMutationData>(
    admin,
    METAFIELDS_SET_MUTATION,
    {
      metafields: [
        {
          ownerId: shopId,
          namespace: APP_METAFIELD_NAMESPACE,
          key: SHOP_LOYALTY_PROGRAM_ENABLED_KEY,
          type: 'boolean',
          value: enabled ? 'true' : 'false',
        },
      ],
    },
  );

  assertNoUserErrors(
    result.metafieldsSet.userErrors,
    'Failed to update program-enabled flag',
  );
}

export async function fetchDisplaySettings(
  admin: AdminApiContext,
): Promise<{
  shopId: string;
  shopDomain: string | null;
  settings: LoyaltyDisplaySettings;
}> {
  const data = await adminGraphql<DisplaySettingsData>(
    admin,
    DISPLAY_SETTINGS_QUERY,
  );

  return {
    shopId: data.shop.id,
    shopDomain: data.shop.myshopifyDomain ?? null,
    settings: parseDisplaySettings(data.shop.displaySettings?.value),
  };
}

export async function setDisplaySettings(
  admin: AdminApiContext,
  shopId: string,
  settings: LoyaltyDisplaySettings,
): Promise<void> {
  const normalized = normalizeDisplaySettings(settings);
  const result = await adminGraphql<MetafieldsSetMutationData>(
    admin,
    METAFIELDS_SET_MUTATION,
    {
      metafields: [
        {
          ownerId: shopId,
          namespace: APP_METAFIELD_NAMESPACE,
          key: SHOP_LOYALTY_DISPLAY_SETTINGS_KEY,
          type: 'json',
          value: JSON.stringify(normalized),
        },
      ],
    },
  );

  assertNoUserErrors(
    result.metafieldsSet.userErrors,
    'Failed to update display settings',
  );
}

export function parseDisplaySettings(
  raw: string | null | undefined,
): LoyaltyDisplaySettings {
  if (!raw) return DEFAULT_LOYALTY_DISPLAY_SETTINGS;

  try {
    const parsed = JSON.parse(raw) as Partial<LoyaltyDisplaySettings>;
    return normalizeDisplaySettings(parsed);
  } catch {
    return DEFAULT_LOYALTY_DISPLAY_SETTINGS;
  }
}

export function normalizeDisplaySettings(
  value: Partial<LoyaltyDisplaySettings>,
): LoyaltyDisplaySettings {
  const defaults = DEFAULT_LOYALTY_DISPLAY_SETTINGS;
  const launcherPosition =
    value.launcherPosition === 'bottom-left' ||
    value.launcherPosition === 'bottom-right'
      ? value.launcherPosition
      : defaults.launcherPosition;

  return {
    launcherEnabled: parseBooleanSetting(
      value.launcherEnabled,
      defaults.launcherEnabled,
    ),
    hydrogenEnabled: parseBooleanSetting(
      value.hydrogenEnabled,
      defaults.hydrogenEnabled,
    ),
    widgetTitle: normalizeText(value.widgetTitle, defaults.widgetTitle, 80),
    widgetIntro: normalizeText(value.widgetIntro, defaults.widgetIntro, 220),
    pointsLabel: normalizeText(value.pointsLabel, defaults.pointsLabel, 32),
    primaryColor: normalizeColor(value.primaryColor, defaults.primaryColor),
    accentColor: normalizeColor(value.accentColor, defaults.accentColor),
    launcherPosition,
  };
}

function parseBooleanSetting(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true';
  return fallback;
}

function normalizeText(value: unknown, fallback: string, maxLength: number) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : fallback;
}

function normalizeColor(value: unknown, fallback: string) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed : fallback;
}
