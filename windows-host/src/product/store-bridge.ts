import {
  STORE_PRODUCT,
  type PartnerCenterIdentity,
  validatePartnerCenterIdentity,
} from "./product-identity.ts";

export type StoreFailureCode =
  | "OFFLINE"
  | "USER_CANCELLED"
  | "NOT_PURCHASED"
  | "ALREADY_PURCHASED"
  | "PACKAGE_IDENTITY_MISSING"
  | "WINDOW_OWNER_MISSING"
  | "PRODUCT_NOT_FOUND"
  | "STORE_UNAVAILABLE"
  | "INVALID_STORE_RESPONSE"
  | "UNKNOWN";

export type StoreCallResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code: StoreFailureCode;
      diagnosticCode?: string;
      retryable: boolean;
    };

export interface StorePriceSnapshot {
  /** StoreProduct.Price.FormattedPrice, displayed verbatim to the customer. */
  formattedPrice: string;
  currencyCode?: string;
  fetchedAt: string;
}

export interface DurableStoreProduct {
  storeId: string;
  inAppOfferToken: string;
  productKind: "DURABLE" | "CONSUMABLE" | "SUBSCRIPTION" | "UNKNOWN";
  title: string;
  price: StorePriceSnapshot;
  isInUserCollection: boolean;
}

export interface DurableStoreLicense {
  storeId: string;
  inAppOfferToken: string;
  isActive: boolean;
  /** A non-expiring durable license must not expose a finite expiry. */
  expiresAt?: string;
  checkedAt: string;
}

export type StorePurchaseStatus =
  | "SUCCEEDED"
  | "ALREADY_PURCHASED"
  | "NOT_PURCHASED"
  | "USER_CANCELLED";

export interface StorePurchaseOutcome {
  status: StorePurchaseStatus;
  completedAt: string;
}

export interface StoreBridgeReadiness {
  packaged: boolean;
  storeAssociated: boolean;
  hwndOwnerInitialized: boolean;
  identity?: PartnerCenterIdentity;
}

/**
 * Implement this interface in the packaged Windows host using
 * Windows.Services.Store.StoreContext. Calls which can display modal Store UI
 * must use a StoreContext initialized with the app window's HWND.
 */
export interface NativeStoreContextBridge {
  readiness(): StoreBridgeReadiness;
  getLifetimeProduct(
    addOnStoreId: string,
  ): Promise<StoreCallResult<DurableStoreProduct>>;
  getLifetimeLicense(
    addOnStoreId: string,
  ): Promise<StoreCallResult<DurableStoreLicense>>;
  requestLifetimePurchase(
    addOnStoreId: string,
  ): Promise<StoreCallResult<StorePurchaseOutcome>>;
}

export type BridgePurpose = "READ" | "PURCHASE";

export function validateBridgeReadiness(
  readiness: StoreBridgeReadiness,
  purpose: BridgePurpose,
): StoreCallResult<PartnerCenterIdentity> {
  if (!readiness.packaged || !readiness.storeAssociated || !readiness.identity) {
    return {
      ok: false,
      code: "PACKAGE_IDENTITY_MISSING",
      retryable: false,
    };
  }
  if (validatePartnerCenterIdentity(readiness.identity).length > 0) {
    return {
      ok: false,
      code: "PACKAGE_IDENTITY_MISSING",
      retryable: false,
    };
  }
  if (purpose === "PURCHASE" && !readiness.hwndOwnerInitialized) {
    return {
      ok: false,
      code: "WINDOW_OWNER_MISSING",
      retryable: false,
    };
  }
  return { ok: true, value: readiness.identity };
}

export function validateDurableProduct(
  product: DurableStoreProduct,
  identity: PartnerCenterIdentity,
): StoreCallResult<DurableStoreProduct> {
  if (
    product.storeId !== identity.lifetimeAddOnStoreId ||
    product.inAppOfferToken !== STORE_PRODUCT.lifetimeAddOn.inAppOfferToken ||
    product.productKind !== STORE_PRODUCT.lifetimeAddOn.productKind ||
    product.price.formattedPrice.trim().length === 0 ||
    !Number.isFinite(Date.parse(product.price.fetchedAt))
  ) {
    return {
      ok: false,
      code: "INVALID_STORE_RESPONSE",
      retryable: false,
    };
  }
  return { ok: true, value: product };
}

export function validateDurableLicense(
  license: DurableStoreLicense,
  identity: PartnerCenterIdentity,
): StoreCallResult<DurableStoreLicense> {
  if (
    license.storeId !== identity.lifetimeAddOnStoreId ||
    license.inAppOfferToken !== STORE_PRODUCT.lifetimeAddOn.inAppOfferToken ||
    !Number.isFinite(Date.parse(license.checkedAt)) ||
    license.expiresAt !== undefined
  ) {
    return {
      ok: false,
      code: "INVALID_STORE_RESPONSE",
      retryable: false,
    };
  }
  return { ok: true, value: license };
}
