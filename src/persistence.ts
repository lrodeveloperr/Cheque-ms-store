import { createCipheriv, createDecipheriv, createHmac, pbkdf2, pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { copyFile, mkdir, open, readFile, realpath, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve as resolvePath } from "node:path";
import { homedir, hostname } from "node:os";
import { promisify } from "node:util";
import { appendAudit, hashCanonical, hashStateCore, verifyAuditChain } from "./audit.ts";
import { defaultFieldAdjustments, defaultStubAdjustments, STOCK_KEYS } from "./calibration.ts";
import { DomainError, invariant } from "./errors.ts";
import { CheckPrinterEngine, createEmptyState } from "./engine.ts";
import type { CalibrationProfile, CheckRecord, EngineState, Entitlement, PrintPlan } from "./types.ts";

const CURRENT_ITERATIONS = 600_000;
const LEGACY_ITERATIONS = 210_000;
const pbkdf2Async = promisify(pbkdf2);

interface EnvelopeV1 { format: "WORKSBIEN-CHECKS"; version: 1; kdf: "PBKDF2-SHA256"; iterations: 210000; salt: string; iv: string; tag: string; ciphertext: string; }
interface EnvelopeV2 { format: "WORKSBIEN-CHECKS"; version: 2; kdf: "PBKDF2-SHA256"; iterations: 600000; salt: string; iv: string; tag: string; keyCheck: string; ciphertext: string; }
type Envelope = EnvelopeV1 | EnvelopeV2;

function deriveKey(secret: string, salt: Buffer, iterations: number): Buffer {
  invariant(secret.length >= 12, "VALIDATION_ERROR", "Storage secret must contain at least 12 characters.", { minimum: 12 }, "validation.storageSecret");
  return pbkdf2Sync(secret, salt, iterations, 32, "sha256");
}

async function deriveKeyAsync(secret: string, salt: Buffer, iterations: number): Promise<Buffer> {
  invariant(secret.length >= 12, "VALIDATION_ERROR", "Storage secret must contain at least 12 characters.", { minimum: 12 }, "validation.storageSecret");
  return Buffer.from(await pbkdf2Async(secret, salt, iterations, 32, "sha256"));
}

function aad(envelope: Pick<Envelope, "format" | "version" | "kdf" | "iterations" | "salt">): Buffer {
  return Buffer.from(`${envelope.format}|${envelope.version}|${envelope.kdf}|${envelope.iterations}|${envelope.salt}`, "utf8");
}

function encryptPayload(payload: unknown, secret: string): string {
  const salt = randomBytes(16); const iv = randomBytes(12); const derived = deriveKey(secret, salt, CURRENT_ITERATIONS);
  const base = { format: "WORKSBIEN-CHECKS" as const, version: 2 as const, kdf: "PBKDF2-SHA256" as const, iterations: CURRENT_ITERATIONS as 600000, salt: salt.toString("base64") };
  const cipher = createCipheriv("aes-256-gcm", derived, iv); cipher.setAAD(aad(base));
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(payload), "utf8")), cipher.final()]);
  const envelope: EnvelopeV2 = { ...base, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), keyCheck: createHmac("sha256", derived).update("worksbien-storage-key-v2").digest("base64"), ciphertext: ciphertext.toString("base64") };
  return JSON.stringify(envelope);
}

async function encryptPayloadAsync(payload: unknown, secret: string): Promise<string> {
  const salt = randomBytes(16); const iv = randomBytes(12); const derived = await deriveKeyAsync(secret, salt, CURRENT_ITERATIONS);
  const base = { format: "WORKSBIEN-CHECKS" as const, version: 2 as const, kdf: "PBKDF2-SHA256" as const, iterations: CURRENT_ITERATIONS as 600000, salt: salt.toString("base64") };
  const cipher = createCipheriv("aes-256-gcm", derived, iv); cipher.setAAD(aad(base));
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(payload), "utf8")), cipher.final()]);
  return JSON.stringify({ ...base, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), keyCheck: createHmac("sha256", derived).update("worksbien-storage-key-v2").digest("base64"), ciphertext: ciphertext.toString("base64") } satisfies EnvelopeV2);
}

function parseEnvelope(serialized: string): Envelope {
  let candidate: Partial<Envelope>;
  try { candidate = JSON.parse(serialized) as Partial<Envelope>; } catch { throw new DomainError("CORRUPT_STORAGE", "Storage envelope is not valid JSON."); }
  const common = candidate.format === "WORKSBIEN-CHECKS" && candidate.kdf === "PBKDF2-SHA256" && typeof candidate.salt === "string" && typeof candidate.iv === "string" && typeof candidate.tag === "string" && typeof candidate.ciphertext === "string";
  const supported = (candidate.version === 1 && candidate.iterations === LEGACY_ITERATIONS) || (candidate.version === 2 && candidate.iterations === CURRENT_ITERATIONS && typeof (candidate as Partial<EnvelopeV2>).keyCheck === "string");
  if (!common || !supported) throw new DomainError("CORRUPT_STORAGE", "Storage envelope metadata is invalid.");
  return candidate as Envelope;
}

function decryptPayload(serialized: string, secret: string): unknown {
  const envelope = parseEnvelope(serialized); const derived = deriveKey(secret, Buffer.from(envelope.salt, "base64"), envelope.iterations);
  if (envelope.version === 2) {
    const expected = createHmac("sha256", derived).update("worksbien-storage-key-v2").digest();
    let actual: Buffer; try { actual = Buffer.from(envelope.keyCheck, "base64"); } catch { throw new DomainError("CORRUPT_STORAGE", "Storage key verifier is invalid."); }
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new DomainError("WRONG_STORAGE_KEY", "The supplied storage key is incorrect.");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", derived, Buffer.from(envelope.iv, "base64"));
    if (envelope.version === 2) decipher.setAAD(aad(envelope));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8"));
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError(envelope.version === 2 ? "TAMPERED_STORAGE" : "WRONG_STORAGE_KEY", envelope.version === 2 ? "The authenticated storage file was modified." : "The storage key is wrong or the legacy file was modified.");
  }
}

async function decryptPayloadAsync(serialized: string, secret: string): Promise<unknown> {
  const envelope = parseEnvelope(serialized); const derived = await deriveKeyAsync(secret, Buffer.from(envelope.salt, "base64"), envelope.iterations);
  if (envelope.version === 2) { const expected = createHmac("sha256", derived).update("worksbien-storage-key-v2").digest(); const actual = Buffer.from(envelope.keyCheck, "base64"); if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new DomainError("WRONG_STORAGE_KEY", "The supplied storage key is incorrect."); }
  try { const decipher = createDecipheriv("aes-256-gcm", derived, Buffer.from(envelope.iv, "base64")); if (envelope.version === 2) decipher.setAAD(aad(envelope)); decipher.setAuthTag(Buffer.from(envelope.tag, "base64")); return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8")); }
  catch (error) { if (error instanceof DomainError) throw error; throw new DomainError(envelope.version === 2 ? "TAMPERED_STORAGE" : "WRONG_STORAGE_KEY", envelope.version === 2 ? "The authenticated storage file was modified." : "The storage key is wrong or the legacy file was modified."); }
}

export function encryptState(state: EngineState, secret: string): string { return encryptPayload(state, secret); }

type OldRecord = Record<string, any>;
interface LegacyState extends OldRecord { schemaVersion: 1 | 2 | 3; revision?: number; accounts?: OldRecord[]; payees?: OldRecord[]; checks?: OldRecord[]; calibrations?: OldRecord[]; audit?: EngineState["audit"]; entitlement?: Entitlement; }

function bindReadyProfilesForMigration(checks: OldRecord[], calibrations: OldRecord[]): string[] {
  const profileIds = new Set(calibrations.map((profile) => profile.id)); const demotedReadyCheckIds: string[] = [];
  for (const check of checks) {
    if (check.readyCalibrationProfileId && profileIds.has(check.readyCalibrationProfileId)) continue;
    const latestAttempt = [...(check.printAttempts ?? [])].reverse().find((attempt: OldRecord) => profileIds.has(attempt.calibrationProfileId));
    if (latestAttempt) { check.readyCalibrationProfileId = latestAttempt.calibrationProfileId; continue; }
    if (check.status === "READY") { check.status = "DRAFT"; delete check.readyCalibrationProfileId; demotedReadyCheckIds.push(check.id); continue; }
    invariant(!["PRINT_QUEUED", "PRINTED", "MISPRINTED"].includes(check.status), "CORRUPT_STORAGE", "A historical printable check has no calibration attempt to restore its Ready binding.", { checkId: check.id });
  }
  return demotedReadyCheckIds;
}

function migrateLegacyState(old: LegacyState, now: () => string): EngineState {
  const audit = structuredClone(old.audit ?? []); verifyAuditChain(audit);
  invariant(old.revision === undefined || old.revision === audit.length, "AUDIT_INTEGRITY_FAILURE", "Legacy revision does not match its audit chain.");
  if (audit.length) invariant(audit.at(-1)?.stateHash === hashStateCore(old as unknown as EngineState), "AUDIT_INTEGRITY_FAILURE", "Stored audit terminal state hash does not match legacy state.");
  const empty = createEmptyState(old.entitlement); const migratedAt = now();
  const accounts: OldRecord[] = (old.accounts ?? []).map((account) => { const bankCountry = account.bankCountry ?? (account.currency === "CAD" ? "CA" : "US"); return { ...account, bankCountry, locale: account.locale ?? (bankCountry === "CA" ? "en-CA" : "en-US"), numberingState: account.numberingState ?? "VERIFIED", archived: account.archived ?? false, updatedAt: account.updatedAt ?? account.createdAt ?? migratedAt }; });
  const payees: OldRecord[] = (old.payees ?? []).map((payee) => ({ ...payee, archived: payee.archived ?? false, updatedAt: payee.updatedAt ?? payee.createdAt ?? migratedAt }));
  const sourceCalibrations = old.calibrations ?? [];
  const calibrationByPair = new Map<string, CalibrationProfile>(); const calibrations: CalibrationProfile[] = [];
  const makeProfile = (source: OldRecord | undefined, accountId: string, preferredId?: string): CalibrationProfile => {
    const sourceId = source?.id ?? "migration-legacy-profile"; const pairKey = `${sourceId}\0${accountId}`; const existing = calibrationByPair.get(pairKey); if (existing) return existing;
    let id = preferredId ?? sourceId; if (calibrations.some((item) => item.id === id)) id = `${sourceId}-account-${hashCanonical(accountId).slice(0, 10)}`;
    const bankCountry = accounts.find((item) => item.id === accountId)?.bankCountry;
    const dateFormat = bankCountry === "CA" ? "YYYY-MM-DD" : (source?.dateFormat ?? "MM/DD/YYYY");
    const layout = (source?.layout ?? "VOUCHER_TOP") as CalibrationProfile["layout"]; const profile: CalibrationProfile = { id, accountId, name: source?.name ?? "Migrated legacy profile", printerKey: source?.printerKey ?? "legacy", stockKey: source?.stockKey ?? STOCK_KEYS[layout], layout, printCheckNumber: source?.printCheckNumber ?? false, dateFormat, amountWordsCurrencyLabel: source?.amountWordsCurrencyLabel ?? true, amountWordsFill: source?.amountWordsFill ?? true, xOffsetPt: source?.xOffsetPt ?? 0, yOffsetPt: source?.yOffsetPt ?? 0, scalePercent: 100, fieldAdjustments: defaultFieldAdjustments(), stubAdjustments: defaultStubAdjustments(), createdAt: source?.createdAt ?? migratedAt, updatedAt: source?.updatedAt ?? source?.createdAt ?? migratedAt };
    calibrationByPair.set(pairKey, profile); calibrations.push(profile); return profile;
  };
  const checks: CheckRecord[] = (old.checks ?? []).map((legacy) => {
    const sample = legacy.sample === true; const attempts = (legacy.printAttempts ?? []).map((attempt: OldRecord) => {
      const source = sourceCalibrations.find((profile) => profile.id === attempt.calibrationProfileId) ?? sourceCalibrations[0];
      const profile = makeProfile(source, legacy.accountId, attempt.calibrationProfileId);
      return { id: attempt.id, documentId: attempt.documentId ?? `migration-document-${attempt.id}`, calibrationProfileId: profile.id, layout: attempt.layout ?? profile.layout, printerKey: attempt.printerKey ?? profile.printerKey, stockKey: attempt.stockKey ?? profile.stockKey, planHash: attempt.planHash ?? hashCanonical({ legacyAttemptId: attempt.id }), queuedAt: attempt.queuedAt, status: sample ? "FAILED" as const : attempt.status, completedAt: sample ? (attempt.completedAt ?? legacy.updatedAt ?? migratedAt) : attempt.completedAt, failureCode: sample ? "LEGACY_SAMPLE_QUARANTINED" : attempt.failureCode };
    });
    const clearedDate = legacy.clearedDate ?? (typeof legacy.clearedAt === "string" ? legacy.clearedAt.slice(0, 10) : undefined);
    const payee = payees.find((item) => item.id === legacy.payeeId); const account = accounts.find((item) => item.id === legacy.accountId);
    const locale = legacy.locale ?? account?.locale ?? (account?.bankCountry === "CA" ? "en-CA" : "en-US");
    return { id: legacy.id, accountId: legacy.accountId, payeeId: legacy.payeeId, payeeSnapshot: legacy.payeeSnapshot ?? { name: payee?.name ?? "[missing payee]", address: payee?.address }, accountSnapshot: { ...(legacy.accountSnapshot ?? { name: account?.name ?? "[missing account]", companyName: account?.companyName ?? "[missing company]", companyAddress: account?.companyAddress }), locale }, checkNumber: legacy.checkNumber, issueDate: legacy.issueDate, amountCents: legacy.amountCents, currency: legacy.currency, locale, memo: legacy.memo ?? "", category: legacy.category === "Uncategorized" ? "UNCATEGORIZED" : (legacy.category ?? "UNCATEGORIZED"), status: sample ? "VOIDED" : legacy.status, warningKeys: legacy.warningKeys ?? [], clearedDate: sample ? undefined : clearedDate, voidReason: sample ? undefined : legacy.voidReason, voidReasonCode: sample ? "LEGACY_SAMPLE_QUARANTINED" : legacy.voidReasonCode, deletedAt: legacy.deletedAt, replacementForCheckId: legacy.replacementForCheckId, replacedByCheckId: legacy.replacedByCheckId, printAttempts: attempts, createdAt: legacy.createdAt, updatedAt: legacy.updatedAt } as CheckRecord;
  });
  for (const source of sourceCalibrations) {
    const usedAccounts = new Set(checks.filter((check) => check.printAttempts.some((attempt) => attempt.calibrationProfileId === source.id || attempt.calibrationProfileId.startsWith(`${source.id}-account-`))).map((check) => check.accountId));
    if (!usedAccounts.size && accounts[0]) usedAccounts.add(accounts[0].id);
    for (const accountId of usedAccounts) makeProfile(source, accountId, source.id);
  }
  const charged = new Set(checks.filter((check) => check.printAttempts.some((attempt) => attempt.status === "QUEUED" || attempt.status === "CONFIRMED" || attempt.status === "MISPRINTED")).map((check) => check.id));
  const state = { ...empty, freeUsageCount: Math.min(3, old.freeUsageCount ?? charged.size), accounts, payees, checks, calibrations, audit, revision: audit.length } as EngineState;
  const demotedReadyCheckIds = bindReadyProfilesForMigration(state.checks as unknown as OldRecord[], state.calibrations as unknown as OldRecord[]);
  state.revision++;
  appendAudit(state.audit, { at: migratedAt, action: "STATE_MIGRATED", entityType: "state", entityId: `schema-${old.schemaVersion}-to-7`, details: { fromSchema: old.schemaVersion, quarantinedSampleIds: (old.checks ?? []).filter((check) => check.sample).map((check) => check.id), demotedReadyCheckIds }, stateHash: hashStateCore(state) });
  return state;
}

function migrateSchema4(old: OldRecord, now: () => string): EngineState {
  const audit = structuredClone(old.audit ?? []) as EngineState["audit"]; verifyAuditChain(audit);
  invariant(old.revision === audit.length, "AUDIT_INTEGRITY_FAILURE", "Stored revision does not match its audit chain.");
  if (audit.length) invariant(audit.at(-1)?.stateHash === hashStateCore(old as EngineState), "AUDIT_INTEGRITY_FAILURE", "Stored audit terminal state hash does not match schema-4 state.");
  const state = structuredClone(old) as OldRecord;
  state.schemaVersion = 7; state.freeUsageBasis = "COUNTED_OR_GUARDED"; state.stockSheets = [];
  state.paymentTemplates = [];
  state.accounts = (state.accounts ?? []).map((account: OldRecord) => { const bankCountry = account.bankCountry ?? (account.currency === "CAD" ? "CA" : "US"); return { ...account, bankCountry, locale: account.locale ?? (bankCountry === "CA" ? "en-CA" : "en-US") }; });
  const accountsById = new Map((state.accounts as OldRecord[]).map((account) => [account.id, account]));
  state.checks = (state.checks ?? []).map((check: OldRecord) => { const account = accountsById.get(check.accountId); const locale = check.locale ?? account?.locale ?? (account?.bankCountry === "CA" ? "en-CA" : "en-US"); return { ...check, locale, accountSnapshot: { ...check.accountSnapshot, locale } }; });
  state.calibrations = (state.calibrations ?? []).map((profile: OldRecord) => ({ ...profile, scalePercent: 100, fieldAdjustments: defaultFieldAdjustments(), stubAdjustments: defaultStubAdjustments() }));
  const demotedReadyCheckIds = bindReadyProfilesForMigration(state.checks as OldRecord[], state.calibrations as OldRecord[]);
  state.audit = audit; state.revision = audit.length + 1;
  const typed = state as EngineState;
  appendAudit(typed.audit, { at: now(), action: "STATE_MIGRATED", entityType: "state", entityId: "schema-4-to-7", details: { fromSchema: 4, demotedReadyCheckIds }, stateHash: hashStateCore(typed) });
  return typed;
}

function migrateSchema5(old: OldRecord, now: () => string): EngineState {
  const audit = structuredClone(old.audit ?? []) as EngineState["audit"]; verifyAuditChain(audit);
  invariant(old.revision === audit.length, "AUDIT_INTEGRITY_FAILURE", "Stored revision does not match its audit chain.");
  if (audit.length) invariant(audit.at(-1)?.stateHash === hashStateCore(old as EngineState), "AUDIT_INTEGRITY_FAILURE", "Stored audit terminal state hash does not match schema-5 state.");
  const state = structuredClone(old) as OldRecord; state.schemaVersion = 7; state.freeUsageBasis = "COUNTED_OR_GUARDED"; state.stockSheets = [];
  const demotedReadyCheckIds = bindReadyProfilesForMigration(state.checks ?? [], state.calibrations ?? []);
  state.audit = audit; state.revision = audit.length + 1; const typed = state as EngineState;
  appendAudit(typed.audit, { at: now(), action: "STATE_MIGRATED", entityType: "state", entityId: "schema-5-to-7", details: { fromSchema: 5, demotedReadyCheckIds }, stateHash: hashStateCore(typed) });
  return typed;
}

function migrateSchema6(old: OldRecord, now: () => string): EngineState {
  const audit = structuredClone(old.audit ?? []) as EngineState["audit"]; verifyAuditChain(audit);
  invariant(old.revision === audit.length, "AUDIT_INTEGRITY_FAILURE", "Stored revision does not match its audit chain.");
  if (audit.length) invariant(audit.at(-1)?.stateHash === hashStateCore(old as EngineState), "AUDIT_INTEGRITY_FAILURE", "Stored audit terminal state hash does not match schema-6 state.");
  const state = structuredClone(old) as OldRecord; state.schemaVersion = 7; state.freeUsageBasis = "COUNTED_OR_GUARDED"; state.stockSheets = [];
  state.audit = audit; state.revision = audit.length + 1; const typed = state as EngineState;
  appendAudit(typed.audit, { at: now(), action: "STATE_MIGRATED", entityType: "state", entityId: "schema-6-to-7", details: { fromSchema: 6 }, stateHash: hashStateCore(typed) });
  return typed;
}

export function migrateState(input: unknown, now: () => string = () => new Date().toISOString()): EngineState {
  invariant(input && typeof input === "object", "CORRUPT_STORAGE", "Stored state is not an object.");
  const candidate = input as Partial<EngineState> & { schemaVersion?: number };
  if (candidate.schemaVersion === 7) return candidate as EngineState;
  if (candidate.schemaVersion === 6) return migrateSchema6(candidate as unknown as OldRecord, now);
  if (candidate.schemaVersion === 5) return migrateSchema5(candidate as unknown as OldRecord, now);
  if (candidate.schemaVersion === 4) return migrateSchema4(candidate as unknown as OldRecord, now);
  if (candidate.schemaVersion === 1 || candidate.schemaVersion === 2 || candidate.schemaVersion === 3) return migrateLegacyState(candidate as unknown as LegacyState, now);
  throw new DomainError("UNSUPPORTED_SCHEMA", "Stored data uses an unsupported schema.", { schemaVersion: candidate.schemaVersion });
}

export function decryptState(serialized: string, secret: string): EngineState {
  try { return new CheckPrinterEngine(migrateState(decryptPayload(serialized, secret))).snapshot(); }
  catch (error) {
    if (error instanceof DomainError && ["WRONG_STORAGE_KEY", "TAMPERED_STORAGE", "UNSUPPORTED_SCHEMA"].includes(error.code)) throw error;
    throw new DomainError("CORRUPT_STORAGE", "Authenticated storage failed semantic validation.", { cause: error instanceof DomainError ? error.code : "INVALID_JSON" });
  }
}

async function decryptStateAsync(serialized: string, secret: string): Promise<EngineState> {
  try { return new CheckPrinterEngine(migrateState(await decryptPayloadAsync(serialized, secret))).snapshot(); }
  catch (error) { if (error instanceof DomainError && ["WRONG_STORAGE_KEY", "TAMPERED_STORAGE", "UNSUPPORTED_SCHEMA"].includes(error.code)) throw error; throw new DomainError("CORRUPT_STORAGE", "Authenticated storage failed semantic validation.", { cause: error instanceof DomainError ? error.code : "INVALID_JSON" }); }
}

interface GuardedSheetSlot {
  sheetId: string;
  slot: number;
  accountId: string;
  calibrationProfileId: string;
  stockKey: string;
  attemptId: string;
  eventAt: string;
  eventSequence?: number;
  state: "RESERVED" | "USED" | "RELEASED";
}
interface LocalGuard { format: "WORKSBIEN-LOCAL-GUARD"; accounts: Record<string, number>; freeUsageCount: number; sheetSlots: Record<string, GuardedSheetSlot>; }
interface GuardRead { guard: LocalGuard; authoritative: boolean; }
interface LegacyHighWater { format: "WORKSBIEN-NUMBER-HIGH-WATER"; accounts: Record<string, number>; }
interface LockOwner { pid: number; token: string; machineId: string; processStartedAt: string; heartbeatAt: string; }
export interface RestoreResult { state: EngineState; preRestorePath?: string; numberAdvances: Array<{ accountId: string; from: number; to: number }>; numberingConfirmationRequired: string[]; }
export interface InstanceLock { release(): Promise<void>; }
export interface StateStoreOptions { guardDirectory?: string; machineId?: string; lockHeartbeatMs?: number; lockStaleMs?: number; now?: () => Date; }

async function exists(path: string): Promise<boolean> { try { await stat(path); return true; } catch { return false; } }

function emptyGuard(): LocalGuard { return { format: "WORKSBIEN-LOCAL-GUARD", accounts: {}, freeUsageCount: 0, sheetSlots: {} }; }

function sheetSlotKey(sheetId: string, slot: number): string { return hashCanonical([sheetId, slot]); }

function laterSheetSlot(left: GuardedSheetSlot | undefined, right: GuardedSheetSlot): GuardedSheetSlot {
  if (!left) return right;
  if (left.eventSequence !== right.eventSequence) {
    if (left.eventSequence === undefined) return right;
    if (right.eventSequence === undefined) return left;
    return right.eventSequence > left.eventSequence ? right : left;
  }
  if (right.eventAt !== left.eventAt) return right.eventAt > left.eventAt ? right : left;
  if (right.attemptId === left.attemptId && right.state !== left.state) {
    const rank = { RESERVED: 1, USED: 2, RELEASED: 3 } as const; return rank[right.state] > rank[left.state] ? right : left;
  }
  return right.attemptId > left.attemptId ? right : left;
}

function stateSheetSlots(state: EngineState): Record<string, GuardedSheetSlot> {
  const entries: Record<string, GuardedSheetSlot> = {};
  for (const check of state.checks) for (const attempt of check.printAttempts) {
    if (attempt.sheetId === undefined || attempt.sheetSlot === undefined) continue;
    const queuedSequence = state.audit.find((entry) => entry.action === "PRINT_PLAN_CREATED" && Array.isArray(entry.details.attemptIds) && entry.details.attemptIds.includes(attempt.id))?.sequence;
    const nextAttempt = check.printAttempts[check.printAttempts.indexOf(attempt) + 1];
    const nextQueuedSequence = nextAttempt ? state.audit.find((entry) => entry.action === "PRINT_PLAN_CREATED" && Array.isArray(entry.details.attemptIds) && entry.details.attemptIds.includes(nextAttempt.id))?.sequence : undefined;
    const completionSequence = attempt.status === "QUEUED" || queuedSequence === undefined ? undefined : state.audit.filter((entry) => entry.sequence > queuedSequence && (nextQueuedSequence === undefined || entry.sequence < nextQueuedSequence) && entry.action === "CHECK_STATUS_CHANGED" && entry.entityId === check.id && entry.details.from === "PRINT_QUEUED").at(-1)?.sequence;
    const entry: GuardedSheetSlot = { sheetId: attempt.sheetId, slot: attempt.sheetSlot, accountId: check.accountId, calibrationProfileId: attempt.calibrationProfileId, stockKey: attempt.stockKey, attemptId: attempt.id, eventAt: attempt.completedAt ?? attempt.queuedAt, eventSequence: completionSequence ?? queuedSequence, state: attempt.status === "FAILED" ? "RELEASED" : (attempt.status === "QUEUED" ? "RESERVED" : "USED") };
    const key = sheetSlotKey(entry.sheetId, entry.slot); entries[key] = laterSheetSlot(entries[key], entry);
  }
  return entries;
}

function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

export class EncryptedStateStore {
  readonly #guardDirectory: string;
  readonly #machineId: string;
  readonly #lockHeartbeatMs: number;
  readonly #lockStaleMs: number;
  readonly #now: () => Date;

  constructor(options: StateStoreOptions = {}) {
    this.#guardDirectory = options.guardDirectory ?? (process.platform === "win32" ? join(process.env.LOCALAPPDATA ?? homedir(), "WorksBien", "CheckPrinter", "guards") : join(homedir(), ".local", "share", "worksbien", "check-printer", "guards"));
    this.#machineId = options.machineId ?? hostname(); this.#lockHeartbeatMs = options.lockHeartbeatMs ?? 10_000; this.#lockStaleMs = options.lockStaleMs ?? 60_000; this.#now = options.now ?? (() => new Date());
  }

  #externalGuardPath(path: string): string { return join(this.#guardDirectory, `${hashCanonical(resolvePath(path))}.guard`); }

  async #writeHeartbeat(path: string, heartbeatAt: string): Promise<void> { const handle = await open(path, "w", 0o600); try { await handle.writeFile(heartbeatAt, "utf8"); await handle.sync(); } finally { await handle.close(); } }

  async #acquireLockFile(lockPath: string, message: string) {
    await mkdir(dirname(lockPath), { recursive: true });
    for (let attempt = 0; attempt < 3; attempt++) {
      const timestamp = this.#now().toISOString(); const owner: LockOwner = { pid: process.pid, token: randomUUID(), machineId: this.#machineId, processStartedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(), heartbeatAt: timestamp };
      try {
        const handle = await open(lockPath, "wx", 0o600); await handle.writeFile(JSON.stringify(owner), "utf8"); await handle.sync(); await handle.close();
        const heartbeatPath = `${lockPath}.${owner.token}.heartbeat`; await this.#writeHeartbeat(heartbeatPath, timestamp);
        let heartbeatQueue = Promise.resolve();
        const timer = setInterval(() => { heartbeatQueue = heartbeatQueue.then(async () => { owner.heartbeatAt = this.#now().toISOString(); await this.#writeHeartbeat(heartbeatPath, owner.heartbeatAt); }).catch(() => undefined); }, this.#lockHeartbeatMs);
        timer.unref(); return { owner, lockPath, heartbeatPath, timer, waitForHeartbeat: () => heartbeatQueue };
      }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw new DomainError("CONCURRENT_WRITE", message, { path: lockPath, cause: (error as NodeJS.ErrnoException).code });
        let observed = ""; let existing: Partial<LockOwner> = {};
        try { observed = await readFile(lockPath, "utf8"); existing = JSON.parse(observed) as Partial<LockOwner>; } catch { /* age check below */ }
        const heartbeatPath = typeof existing.token === "string" ? `${lockPath}.${existing.token}.heartbeat` : undefined;
        const heartbeatAt = heartbeatPath ? await readFile(heartbeatPath, "utf8").catch(() => existing.heartbeatAt) : existing.heartbeatAt;
        const age = heartbeatAt ? this.#now().getTime() - Date.parse(heartbeatAt) : await stat(lockPath).then((value) => this.#now().getTime() - value.mtimeMs).catch(() => this.#lockStaleMs + 1);
        const stale = age > this.#lockStaleMs || ((!existing.machineId || existing.machineId === this.#machineId) && typeof existing.pid === "number" && !processIsAlive(existing.pid));
        if (!stale) throw new DomainError("CONCURRENT_WRITE", message, { path: lockPath, ownerPid: existing.pid, ownerMachineId: existing.machineId, heartbeatAt: existing.heartbeatAt }, "storage.locked");
        const unchanged = await readFile(lockPath, "utf8").then((value) => value === observed).catch(() => false);
        if (unchanged) { await unlink(lockPath).catch(() => undefined); if (heartbeatPath) await unlink(heartbeatPath).catch(() => undefined); }
      }
    }
    throw new DomainError("CONCURRENT_WRITE", message, { path: lockPath });
  }

  async #releaseLockFile(lock: { owner: LockOwner; lockPath: string; heartbeatPath: string; timer: NodeJS.Timeout; waitForHeartbeat(): Promise<void> }): Promise<void> {
    clearInterval(lock.timer); await lock.waitForHeartbeat();
    const owner = await readFile(lock.lockPath, "utf8").then((value) => JSON.parse(value) as Partial<LockOwner>).catch(() => undefined);
    if (owner?.token === lock.owner.token) await unlink(lock.lockPath).catch(() => undefined);
    await unlink(lock.heartbeatPath).catch(() => undefined);
  }

  async acquireInstanceLock(path: string): Promise<InstanceLock> {
    const lock = await this.#acquireLockFile(`${path}.instance.lock`, "Another app instance already owns this data file."); let released = false;
    return { release: async () => { if (released) return; released = true; await this.#releaseLockFile(lock); } };
  }

  async inspectInstanceLock(path: string): Promise<Omit<LockOwner, "token"> | undefined> { const lockPath = `${path}.instance.lock`; const owner = await readFile(lockPath, "utf8").then((value) => JSON.parse(value) as LockOwner).catch(() => undefined); if (!owner) return undefined; const heartbeatAt = await readFile(`${lockPath}.${owner.token}.heartbeat`, "utf8").catch(() => owner.heartbeatAt); const { token: _token, ...safe } = owner; return { ...safe, heartbeatAt }; }

  async breakInstanceLock(path: string, confirmation: "BREAK_LOCK"): Promise<boolean> { invariant(confirmation === "BREAK_LOCK", "VALIDATION_ERROR", "Breaking an instance lock requires explicit confirmation.", {}, "storage.breakLockConfirm"); const lockPath = `${path}.instance.lock`; const observed = await readFile(lockPath, "utf8").catch(() => undefined); if (!observed) return false; const parsed = JSON.parse(observed) as Partial<LockOwner>; const unchanged = await readFile(lockPath, "utf8").then((value) => value === observed).catch(() => false); if (unchanged) { await unlink(lockPath); if (parsed.token) await unlink(`${lockPath}.${parsed.token}.heartbeat`).catch(() => undefined); } return unchanged; }

  async #withLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
    const lock = await this.#acquireLockFile(`${path}.lock`, "Another process holds the state-file lock.");
    try { return await operation(); } finally { await this.#releaseLockFile(lock); }
  }

  async #atomicWrite(path: string, contents: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true }); const temporary = `${path}.tmp`; const handle = await open(temporary, "w", 0o600);
    try { await handle.writeFile(contents, "utf8"); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, path); const directory = await open(dirname(path), "r"); try { await directory.sync(); } finally { await directory.close(); }
  }

  async #readGuard(path: string, secret: string): Promise<GuardRead> {
    const external = this.#externalGuardPath(path); const authoritative = await exists(external); const sibling = await exists(`${path}.guard`) ? `${path}.guard` : (await exists(`${path}.numbers`) ? `${path}.numbers` : undefined);
    const paths = [authoritative ? external : undefined, sibling].filter((value): value is string => Boolean(value));
    let merged = emptyGuard();
    for (const guardPath of paths) {
      const payload = await decryptPayloadAsync(await readFile(guardPath, "utf8"), secret) as { format?: LocalGuard["format"] | LegacyHighWater["format"]; accounts?: Record<string, number>; freeUsageCount?: number; sheetSlots?: Record<string, GuardedSheetSlot> };
      const validAccounts = payload.accounts && typeof payload.accounts === "object" && Object.values(payload.accounts).every((value) => Number.isSafeInteger(value) && value > 0);
      invariant((payload.format === "WORKSBIEN-LOCAL-GUARD" || payload.format === "WORKSBIEN-NUMBER-HIGH-WATER") && validAccounts, "CORRUPT_STORAGE", "Local recovery guard is invalid.");
      const freeUsageCount = payload.format === "WORKSBIEN-LOCAL-GUARD" ? payload.freeUsageCount : 0; invariant(Number.isInteger(freeUsageCount) && freeUsageCount! >= 0 && freeUsageCount! <= 3, "CORRUPT_STORAGE", "Local free-usage guard is invalid.");
      const accounts = { ...merged.accounts }; for (const [id, nextCheckNumber] of Object.entries(payload.accounts!)) accounts[id] = Math.max(accounts[id] ?? 0, nextCheckNumber);
      const sheetSlots = { ...merged.sheetSlots };
      for (const [key, entry] of Object.entries(payload.sheetSlots ?? {})) {
        const valid = entry && typeof entry.sheetId === "string" && Number.isInteger(entry.slot) && entry.slot >= 0 && entry.slot < 3 && typeof entry.accountId === "string" && typeof entry.calibrationProfileId === "string" && typeof entry.stockKey === "string" && typeof entry.attemptId === "string" && !Number.isNaN(Date.parse(entry.eventAt)) && (entry.eventSequence === undefined || (Number.isSafeInteger(entry.eventSequence) && entry.eventSequence > 0)) && ["RESERVED", "USED", "RELEASED"].includes(entry.state);
        invariant(valid && key === sheetSlotKey(entry.sheetId, entry.slot), "CORRUPT_STORAGE", "Local sheet-slot guard is invalid.");
        sheetSlots[key] = laterSheetSlot(sheetSlots[key], entry);
      }
      merged = { format: "WORKSBIEN-LOCAL-GUARD", accounts, freeUsageCount: Math.max(merged.freeUsageCount, freeUsageCount!), sheetSlots };
    }
    return { guard: merged, authoritative };
  }

  #mergeGuard(state: EngineState, existing: LocalGuard): LocalGuard {
    const accounts = { ...existing.accounts }; for (const account of state.accounts) accounts[account.id] = Math.max(accounts[account.id] ?? 0, account.nextCheckNumber);
    const sheetSlots = { ...existing.sheetSlots };
    for (const [key, entry] of Object.entries(stateSheetSlots(state))) sheetSlots[key] = laterSheetSlot(sheetSlots[key], entry);
    return { format: "WORKSBIEN-LOCAL-GUARD", accounts, freeUsageCount: Math.min(3, Math.max(existing.freeUsageCount, state.freeUsageCount)), sheetSlots };
  }

  #applyGuard(state: EngineState, guard: LocalGuard): EngineState {
    const validated = new CheckPrinterEngine(state).snapshot(); const stateEvents = stateSheetSlots(validated); let sheetChanged = false;
    for (const [key, entry] of Object.entries(guard.sheetSlots)) {
      if (laterSheetSlot(stateEvents[key], entry) !== entry) continue;
      const account = validated.accounts.find((candidate) => candidate.id === entry.accountId); const profile = validated.calibrations.find((candidate) => candidate.id === entry.calibrationProfileId);
      if (!account || !profile || profile.accountId !== account.id || profile.stockKey !== entry.stockKey) continue;
      let sheet = validated.stockSheets.find((candidate) => candidate.id === entry.sheetId);
      const shouldUse = entry.state !== "RELEASED";
      if (!sheet && shouldUse) { sheet = { id: entry.sheetId, accountId: entry.accountId, calibrationProfileId: entry.calibrationProfileId, stockKey: entry.stockKey, usedSlots: [], createdAt: entry.eventAt, updatedAt: entry.eventAt }; validated.stockSheets.push(sheet); sheetChanged = true; }
      if (!sheet || sheet.accountId !== entry.accountId || sheet.calibrationProfileId !== entry.calibrationProfileId || sheet.stockKey !== entry.stockKey) continue;
      const has = sheet.usedSlots.includes(entry.slot);
      if (shouldUse && !has) { sheet.usedSlots.push(entry.slot); sheet.usedSlots.sort(); sheet.updatedAt = entry.eventAt; sheetChanged = true; }
      if (!shouldUse && has) { sheet.usedSlots = sheet.usedSlots.filter((slot) => slot !== entry.slot); sheet.updatedAt = entry.eventAt; sheetChanged = true; }
    }
    if (sheetChanged) { validated.revision++; appendAudit(validated.audit, { at: this.#now().toISOString(), action: "STOCK_SHEET_GUARD_APPLIED", entityType: "state", entityId: "recovery", details: { guardedSlots: Object.keys(guard.sheetSlots).length }, stateHash: hashStateCore(validated) }); }
    const engine = new CheckPrinterEngine(validated);
    for (const account of state.accounts) { const high = guard.accounts[account.id]; if (high && high > account.nextCheckNumber) engine.raiseNextCheckNumber(account.id, high, "RESTORE_HIGH_WATER"); }
    engine.raiseFreeUsageCount(guard.freeUsageCount, "RESTORE_HIGH_WATER"); return engine.snapshot();
  }

  async #writeUnlocked(path: string, state: EngineState, secret: string, existingGuard: LocalGuard = emptyGuard()): Promise<void> {
    try { new CheckPrinterEngine(state); } catch (error) { throw new DomainError("CORRUPT_STORAGE", "Refusing to save semantically invalid state.", { cause: error instanceof DomainError ? error.code : "UNKNOWN" }); }
    const merged = this.#mergeGuard(state, existingGuard);
    const encryptedGuard = await encryptPayloadAsync(merged, secret); await this.#atomicWrite(this.#externalGuardPath(path), encryptedGuard); await this.#atomicWrite(`${path}.guard`, encryptedGuard);
    await this.#atomicWrite(path, await encryptPayloadAsync(state, secret));
  }

  async save(path: string, state: EngineState, secret: string, expectedRevision?: number): Promise<void> {
    await this.#withLock(path, async () => {
      const fileExists = await exists(path); let guard = emptyGuard();
      if (fileExists) {
        invariant(expectedRevision !== undefined, "STALE_REVISION", "Saving an existing state requires its expected revision.");
        const current = await this.load(path, secret); invariant(current.revision === expectedRevision, "STALE_REVISION", "State changed since it was loaded.", { expectedRevision, actualRevision: current.revision });
        guard = (await this.#readGuard(path, secret)).guard;
        for (const account of state.accounts) invariant(account.nextCheckNumber >= (guard.accounts[account.id] ?? 0), "STALE_REVISION", "Refusing to lower a persisted check-number high-water mark.", { accountId: account.id, highWater: guard.accounts[account.id], proposed: account.nextCheckNumber });
        invariant(state.freeUsageCount >= guard.freeUsageCount, "STALE_REVISION", "Refusing to lower the local Free-use high-water mark.", { highWater: guard.freeUsageCount, proposed: state.freeUsageCount });
      } else invariant(expectedRevision === undefined || expectedRevision === 0, "STALE_REVISION", "A new state file cannot match a non-zero revision.", { expectedRevision });
      await this.#writeUnlocked(path, state, secret, guard);
    });
  }

  async load(path: string, secret: string): Promise<EngineState> { const state = await decryptStateAsync(await readFile(path, "utf8"), secret); const read = await this.#readGuard(path, secret); let guarded = this.#applyGuard(state, read.guard); if (!read.authoritative) { const engine = new CheckPrinterEngine(guarded); for (const account of guarded.accounts) engine.requireNumberingConfirmation(account.id); guarded = engine.snapshot(); } return guarded; }

  async #assertDistinctPaths(sourcePath: string, targetPath: string): Promise<void> {
    await mkdir(dirname(targetPath), { recursive: true }); const sourceCanonical = await realpath(sourcePath);
    const targetCanonical = await exists(targetPath) ? await realpath(targetPath) : join(await realpath(dirname(targetPath)), basename(targetPath));
    const normalize = (value: string) => process.platform === "win32" ? value.toLocaleLowerCase("en") : value;
    invariant(normalize(sourceCanonical) !== normalize(targetCanonical) && resolvePath(sourcePath) !== resolvePath(targetPath), "VALIDATION_ERROR", "Backup path must differ from the live state path.");
    if (await exists(targetPath)) { const [sourceInfo, targetInfo] = await Promise.all([stat(sourcePath), stat(targetPath)]); invariant(sourceInfo.dev !== targetInfo.dev || sourceInfo.ino !== targetInfo.ino, "VALIDATION_ERROR", "Backup target aliases the live state file."); }
  }

  async createBackup(sourcePath: string, backupPath: string, sourceSecret: string, recoveryPassphrase: string): Promise<void> {
    await this.#assertDistinctPaths(sourcePath, backupPath);
    invariant(sourceSecret !== recoveryPassphrase, "VALIDATION_ERROR", "Use a recovery passphrase that is different from the live storage secret.", {}, "validation.storageSecret");
    const state = await this.load(sourcePath, sourceSecret); await this.#atomicWrite(backupPath, await encryptPayloadAsync(state, recoveryPassphrase));
    const verified = await decryptStateAsync(await readFile(backupPath, "utf8"), recoveryPassphrase); invariant(hashStateCore(verified) === hashStateCore(state), "CORRUPT_STORAGE", "Backup verification failed.");
  }

  async restoreBackup(backupPath: string, destinationPath: string, backupPassphrase: string, destinationSecret: string, expectedRevision?: number): Promise<RestoreResult> {
    await this.#assertDistinctPaths(backupPath, destinationPath); const backupState = await decryptStateAsync(await readFile(backupPath, "utf8"), backupPassphrase);
    return this.#withLock(destinationPath, async () => {
      let preRestorePath: string | undefined; let current: EngineState | undefined; let guard = emptyGuard(); const destinationExists = await exists(destinationPath);
      if (destinationExists) {
        invariant(expectedRevision !== undefined, "STALE_REVISION", "Restoring over existing data requires its expected revision.");
        current = await this.load(destinationPath, destinationSecret); invariant(current.revision === expectedRevision, "STALE_REVISION", "State changed before restore.", { expectedRevision, actualRevision: current.revision });
        guard = (await this.#readGuard(destinationPath, destinationSecret)).guard;
        preRestorePath = `${destinationPath}.pre-restore-${new Date().toISOString().replace(/[:.]/g, "-")}`; await copyFile(destinationPath, preRestorePath);
      } else invariant(expectedRevision === undefined || expectedRevision === 0, "STALE_REVISION", "Restore destination does not have the expected revision.");
      for (const account of current?.accounts ?? []) guard.accounts[account.id] = Math.max(guard.accounts[account.id] ?? 0, account.nextCheckNumber);
      if (current) {
        const rolledBackQueued = current.checks.filter((check) => {
          if (check.status !== "PRINT_QUEUED" || check.replacementForCheckId) return false;
          const currentAttempt = check.printAttempts.find((attempt) => attempt.status === "QUEUED"); const backupCheck = backupState.checks.find((candidate) => candidate.id === check.id); const backupAttempt = backupCheck?.printAttempts.find((attempt) => attempt.status === "QUEUED");
          return !currentAttempt || !backupAttempt || currentAttempt.id !== backupAttempt.id || currentAttempt.documentId !== backupAttempt.documentId;
        }).length;
        guard.freeUsageCount = Math.min(3, Math.max(guard.freeUsageCount, current.freeUsageCount + rolledBackQueued));
      }
      const engine = new CheckPrinterEngine(backupState); const numberAdvances: RestoreResult["numberAdvances"] = []; const numberingConfirmationRequired: string[] = [];
      for (const account of backupState.accounts) { const high = guard.accounts[account.id]; if (high && high > account.nextCheckNumber) { numberAdvances.push({ accountId: account.id, from: account.nextCheckNumber, to: high }); engine.raiseNextCheckNumber(account.id, high, "RESTORE_HIGH_WATER"); } else if (!high) { engine.requireNumberingConfirmation(account.id); numberingConfirmationRequired.push(account.id); } }
      if (destinationExists) engine.raiseFreeUsageCount(guard.freeUsageCount, "RESTORE_HIGH_WATER"); else engine.raiseFreeUsageCount(3, "PORTABLE_RESTORE_CONSERVATIVE");
      const restored = this.#applyGuard(engine.snapshot(), guard); await this.#writeUnlocked(destinationPath, restored, destinationSecret, guard); return { state: restored, preRestorePath, numberAdvances, numberingConfirmationRequired };
    });
  }

  async recoverInterruptedSave(path: string, secret: string): Promise<"NONE" | "PROMOTED_TEMP" | "DISCARDED_TEMP"> {
    const temporary = `${path}.tmp`; if (!await exists(temporary)) return "NONE";
    return this.#withLock(path, async () => {
      let candidate: EngineState | undefined; try { candidate = await decryptStateAsync(await readFile(temporary, "utf8"), secret); } catch { await unlink(temporary); return "DISCARDED_TEMP"; }
      let current: EngineState | undefined; try { if (await exists(path)) current = await decryptStateAsync(await readFile(path, "utf8"), secret); } catch { current = undefined; }
      if (!current || candidate.revision > current.revision) { await rename(temporary, path); const guard = await this.#readGuard(path, secret).then((value) => value.guard).catch(() => emptyGuard()); const guarded = this.#applyGuard(candidate, guard); await this.#writeUnlocked(path, guarded, secret, guard); return "PROMOTED_TEMP"; }
      await unlink(temporary); return "DISCARDED_TEMP";
    });
  }

  async queuePrintDurably(path: string, secret: string, expectedRevision: number, input: { checkIds: string[]; calibrationProfileId: string; printerKey: string; stockKey: string; startSlot?: number; sheetIds?: string[] }): Promise<{ state: EngineState; plan: PrintPlan; planHash: string; attemptIds: string[] }> {
    return this.#withLock(path, async () => {
      const current = await this.load(path, secret); invariant(current.revision === expectedRevision, "STALE_REVISION", "State changed before print was queued.", { expectedRevision, actualRevision: current.revision });
      const guard = (await this.#readGuard(path, secret)).guard; const engine = new CheckPrinterEngine(current); const queued = engine.queuePrint(input.checkIds, input.calibrationProfileId, input.printerKey, input.stockKey, input.startSlot ?? 0, input.sheetIds ?? []); const state = engine.snapshot();
      await this.#writeUnlocked(path, state, secret, guard); return { state, ...queued };
    });
  }
}
