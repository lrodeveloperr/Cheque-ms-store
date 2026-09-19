import { createHash } from "node:crypto";
import { DomainError } from "./errors.ts";
import type { AuditEntry, EngineState } from "./types.ts";

function canonical(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

export function hashCanonical(value: unknown): string {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

export function hashStateCore(state: EngineState): string {
  const { audit: _audit, ...core } = state;
  return hashCanonical(core);
}

export function hashAuditEntry(entry: Omit<AuditEntry, "hash">): string {
  return hashCanonical(entry);
}

export function appendAudit(entries: AuditEntry[], input: Omit<AuditEntry, "sequence" | "previousHash" | "hash">): AuditEntry {
  const previous = entries.at(-1);
  const partial: Omit<AuditEntry, "hash"> = {
    sequence: (previous?.sequence ?? 0) + 1,
    previousHash: previous?.hash ?? "GENESIS",
    ...input
  };
  const entry: AuditEntry = { ...partial, hash: hashAuditEntry(partial) };
  entries.push(entry);
  return entry;
}

export function verifyAuditChain(entries: AuditEntry[]): true {
  let prior = "GENESIS";
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const { hash, ...partial } = entry;
    if (entry.sequence !== index + 1 || entry.previousHash !== prior || hashAuditEntry(partial) !== hash) {
      throw new DomainError("AUDIT_INTEGRITY_FAILURE", "Audit chain verification failed.", { sequence: entry.sequence });
    }
    prior = hash;
  }
  return true;
}
