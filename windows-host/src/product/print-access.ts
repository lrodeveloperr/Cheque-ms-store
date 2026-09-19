import { FREE_LIVE_CHEQUE_LIMIT } from "./product-identity.ts";
import type { CommerceSnapshot } from "./entitlement.ts";

export type OutputPurpose = "SAMPLE" | "CALIBRATION" | "LIVE";

export interface LivePrintUsage {
  freeUsageCount: number;
  queuedChargeableCount: number;
  isReplacement: boolean;
}

export type PrintAccessDecision =
  | {
      allowed: true;
      basis: "UNLIMITED_NON_NEGOTIABLE" | "LIFETIME" | "FREE" | "REPLACEMENT";
      remainingFreeAfterQueue?: number;
      disclosurePrice?: string;
    }
  | {
      allowed: false;
      reason:
        | "PRICE_DISCLOSURE_REQUIRED"
        | "LICENSE_VERIFICATION_REQUIRED"
        | "LIFETIME_REQUIRED";
      messageKey:
        | "purchase.priceRequired"
        | "purchase.verificationRequired"
        | "purchase.freeLimitReached";
    };

export function decidePrintAccess(
  purpose: OutputPurpose,
  usage: LivePrintUsage,
  commerce: CommerceSnapshot,
): PrintAccessDecision {
  if (purpose !== "LIVE") {
    return { allowed: true, basis: "UNLIMITED_NON_NEGOTIABLE" };
  }
  if (
    !Number.isInteger(usage.freeUsageCount) ||
    usage.freeUsageCount < 0 ||
    usage.freeUsageCount > FREE_LIVE_CHEQUE_LIMIT ||
    !Number.isInteger(usage.queuedChargeableCount) ||
    usage.queuedChargeableCount < 0
  ) {
    throw new Error("Invalid free-use counters");
  }
  if (commerce.entitlement === "LIFETIME") {
    if (!commerce.canStartNewLivePrint) {
      return {
        allowed: false,
        reason: "LICENSE_VERIFICATION_REQUIRED",
        messageKey: "purchase.verificationRequired",
      };
    }
    return { allowed: true, basis: "LIFETIME" };
  }
  if (usage.isReplacement) {
    return { allowed: true, basis: "REPLACEMENT" };
  }
  if (!commerce.canStartNewLivePrint) {
    return {
      allowed: false,
      reason:
        commerce.verification === "VERIFICATION_REQUIRED"
          ? "LICENSE_VERIFICATION_REQUIRED"
          : "PRICE_DISCLOSURE_REQUIRED",
      messageKey:
        commerce.verification === "VERIFICATION_REQUIRED"
          ? "purchase.verificationRequired"
          : "purchase.priceRequired",
    };
  }
  if (!commerce.price?.formattedPrice) {
    return {
      allowed: false,
      reason: "PRICE_DISCLOSURE_REQUIRED",
      messageKey: "purchase.priceRequired",
    };
  }
  const usedOrReserved = usage.freeUsageCount + usage.queuedChargeableCount;
  if (usedOrReserved >= FREE_LIVE_CHEQUE_LIMIT) {
    return {
      allowed: false,
      reason: "LIFETIME_REQUIRED",
      messageKey: "purchase.freeLimitReached",
    };
  }
  return {
    allowed: true,
    basis: "FREE",
    remainingFreeAfterQueue: FREE_LIVE_CHEQUE_LIMIT - usedOrReserved - 1,
    disclosurePrice: commerce.price.formattedPrice,
  };
}

/** Resolving a durably queued document must never depend on current entitlement. */
export function canResolveQueuedDocument(): true {
  return true;
}
