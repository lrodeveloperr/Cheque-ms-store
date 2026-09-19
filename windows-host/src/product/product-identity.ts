export const STORE_PRODUCT = Object.freeze({
  storeTitle: "Check Printer & Check Writer",
  packageDisplayName: "Check Printer & Check Writer",
  publisherDisplayName: "WorksBien Studios Inc.",
  packageIdentityNamePlaceholder: "WorksBienStudios.CheckPrinterCheckWriter",
  lifetimeAddOn: Object.freeze({
    inAppOfferToken: "lifetime_unlock",
    storeId: undefined as string | undefined,
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

export interface PartnerCenterIdentity {
  packageIdentityName: string;
  packageFamilyName: string;
  publisherSubject: string;
  appStoreId: string;
  lifetimeAddOnStoreId: string;
}

const STORE_ID_PATTERN = /^[A-Z0-9]{12}$/i;

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
