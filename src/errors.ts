import { localize, type SupportedLocale } from "./localization.ts";

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "DUPLICATE_CHECK_NUMBER"
  | "INVALID_TRANSITION"
  | "ENTITLEMENT_REQUIRED"
  | "AUDIT_INTEGRITY_FAILURE"
  | "CORRUPT_STORAGE"
  | "WRONG_STORAGE_KEY"
  | "TAMPERED_STORAGE"
  | "STALE_REVISION"
  | "CONCURRENT_WRITE"
  | "UNSUPPORTED_SCHEMA"
  | "CSV_LIMIT_EXCEEDED"
  | "CSV_MALFORMED";

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly messageKey: string;
  readonly developerMessage: string;
  readonly details: Record<string, unknown>;

  constructor(code: ErrorCode, developerMessage: string, details: Record<string, unknown> = {}, messageKey = `error.${code}`) {
    super(messageKey);
    this.name = "DomainError";
    this.code = code;
    this.messageKey = messageKey;
    this.developerMessage = developerMessage;
    this.details = details;
  }

  localizedMessage(locale: SupportedLocale): string { return localize(locale, this.messageKey, this.details); }
}

export function invariant(condition: unknown, code: ErrorCode, message: string, details: Record<string, unknown> = {}, messageKey?: string): asserts condition {
  if (!condition) throw new DomainError(code, message, details, messageKey);
}
