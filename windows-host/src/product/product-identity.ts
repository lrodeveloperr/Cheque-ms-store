import productionPartnerCenterConfig from "./partner-center.production.json" with { type: "json" };

export interface PartnerCenterIdentity {
  packageIdentityName: string;
  packageFamilyName: string;
  publisherSubject: string;
  appStoreId: string;
  lifetimeAddOnStoreId: string;
}

export interface PartnerCenterReleaseConfig extends PartnerCenterIdentity {
  publisherDisplayName: string;
}

export const PRODUCTION_PARTNER_CENTER_CONFIG = Object.freeze({
  packageIdentityName: productionPartnerCenterConfig.packageIdentityName,
  packageFamilyName: productionPartnerCenterConfig.packageFamilyName,
  publisherSubject: productionPartnerCenterConfig.publisherSubject,
  publisherDisplayName: productionPartnerCenterConfig.publisherDisplayName,
  appStoreId: productionPartnerCenterConfig.appStoreId,
  lifetimeAddOnStoreId: productionPartnerCenterConfig.lifetimeAddOnStoreId,
}) satisfies Readonly<PartnerCenterReleaseConfig>;

export const STORE_PRODUCT = Object.freeze({
  storeTitle: "Check Printer & Check Writer",
  localizedStoreTitles: Object.freeze({
    "en-US": "Check Printer & Check Writer",
    "en-CA": "Check Printer & Check Writer",
    "fr-CA": "Impression et rédaction de chèques",
  }),
  packageDisplayName: "Check Printer & Check Writer",
  publisherDisplayName: "WorksBien Studios Inc.",
  packageIdentityNamePlaceholder: "WorksBienStudios.CheckPrinterCheckWriter",
  lifetimeAddOn: Object.freeze({
    inAppOfferToken: "lifetime_unlock",
    storeId: PRODUCTION_PARTNER_CENTER_CONFIG.lifetimeAddOnStoreId,
    productKind: "DURABLE" as const,
    duration: "NEVER_EXPIRES" as const,
  }),
  targetCatalogPrices: Object.freeze({
    US: Object.freeze({ currency: "USD" as const, minorUnits: 1_999 }),
    CA: Object.freeze({ currency: "CAD" as const, minorUnits: 2_599 }),
  }),
});

export const FREE_LIVE_CHEQUE_LIMIT = 3 as const;
export const OFFLINE_LICENSE_GRACE_DAYS = 30 as const;
export const PRICE_DISCLOSURE_MAX_AGE_DAYS = 30 as const;

export type LaunchHostLocale = "en-US" | "en-CA" | "fr-CA";

export const LAUNCH_HOST_LOCALES = Object.freeze([
  "en-US",
  "en-CA",
  "fr-CA",
] as const satisfies readonly LaunchHostLocale[]);

export const DEFERRED_HOST_LOCALES = Object.freeze(["es-US"] as const);

const STORE_ID_PATTERN = /^[A-Z0-9]{12}$/i;

export interface StoreIdentityEnvironment {
  [name: string]: string | undefined;
  WORKSBIEN_PACKAGE_IDENTITY_NAME?: string;
  WORKSBIEN_PACKAGE_FAMILY_NAME?: string;
  WORKSBIEN_PUBLISHER_SUBJECT?: string;
  WORKSBIEN_APP_STORE_ID?: string;
  WORKSBIEN_LIFETIME_STORE_ID?: string;
  WORKSBIEN_STORE_ASSOCIATED?: string;
}

function present(value: string): boolean {
  return value.trim().length > 0;
}

/**
 * Partner Center is authoritative for package and Store IDs. The placeholder is
 * useful for project scaffolding but is deliberately rejected for production.
 */
export function validatePartnerCenterIdentity(
  identity: PartnerCenterIdentity,
): string[] {
  const failures: string[] = [];
  if (!present(identity.packageIdentityName)) failures.push("packageIdentityName");
  if (
    identity.packageIdentityName === STORE_PRODUCT.packageIdentityNamePlaceholder
  ) {
    failures.push("packageIdentityName.partnerCenterValueRequired");
  }
  if (!present(identity.packageFamilyName)) failures.push("packageFamilyName");
  if (!present(identity.publisherSubject)) failures.push("publisherSubject");
  if (!STORE_ID_PATTERN.test(identity.appStoreId)) failures.push("appStoreId");
  if (!STORE_ID_PATTERN.test(identity.lifetimeAddOnStoreId)) {
    failures.push("lifetimeAddOnStoreId");
  }
  if (identity.appStoreId === identity.lifetimeAddOnStoreId) {
    failures.push("lifetimeAddOnStoreId.mustDifferFromApp");
  }
  return failures;
}

/**
 * A Store-installed package always uses the immutable Partner Center identity
 * compiled into the release. Environment overrides remain available only for
 * unpackaged development and adapter testing.
 */
export function resolvePartnerCenterIdentity(
  windowsStore: boolean,
  environment: StoreIdentityEnvironment,
): PartnerCenterIdentity {
  if (windowsStore) return PRODUCTION_PARTNER_CENTER_CONFIG;
  return {
    packageIdentityName: environment.WORKSBIEN_PACKAGE_IDENTITY_NAME
      ?? STORE_PRODUCT.packageIdentityNamePlaceholder,
    packageFamilyName: environment.WORKSBIEN_PACKAGE_FAMILY_NAME
      ?? "not-store-associated",
    publisherSubject: environment.WORKSBIEN_PUBLISHER_SUBJECT
      ?? "not-store-associated",
    appStoreId: environment.WORKSBIEN_APP_STORE_ID ?? "000000000000",
    lifetimeAddOnStoreId: environment.WORKSBIEN_LIFETIME_STORE_ID
      ?? "000000000001",
  };
}

export function storeAssociationEnabled(
  windowsStore: boolean,
  identity: PartnerCenterIdentity,
  environment: StoreIdentityEnvironment,
): boolean {
  const requested = windowsStore || environment.WORKSBIEN_STORE_ASSOCIATED === "1";
  return requested && validatePartnerCenterIdentity(identity).length === 0;
}
