# Independent customer-risk evaluation

Evaluation date: 2026-09-19  
Candidate: 0.4.0-rc.1  
Final verdict: **PASS for the backend; external application gates remain**  
Production code changes by evaluator: none

## Final baseline

- Node 24.19.0
- TypeScript type-check: pass
- `npm test`: superseded final hardening recheck, 76/76 pass
- Coverage: 98.57% lines, 86.26% branches, 95.26% functions
- Deterministic stress: 10,000 lifecycle sequences and 100,000 CSV cases
- PDF evidence: 47 scenario-matrix PDFs plus 12 acceptance PDFs, all Letter size

## Customer risks and closure evidence

| Customer risk | Result | Closure evidence |
|---|---|---|
| Older backup reuses cheque numbers | Pass | Same-destination restore raises the account high-water; fresh restore requires physical-number confirmation. |
| Restore rolls back the Free allowance | Pass | The local encrypted guard preserves use; a fresh destination conservatively exhausts Free. |
| A retained queued job loses its `NOT_SENT` refund | Pass | The identical attempt remains resolvable and returns to `READY` without charging use. |
| Concurrent sessions or crashed locks overwrite data | Pass | Instance ownership, writer locks, expected revisions, owner tokens, and dead-process reclamation are tested. |
| Newer valid crash data is discarded | Pass | A complete higher-revision temporary file is promoted; invalid or older temporary data is rejected. |
| A physically marked cheque is recorded as not printed | Pass | `NOT_SENT` requires trusted host evidence; uncertain output becomes spoiled, can later be corrected to Printed, or can be replaced with a new number. |
| An entitlement refresh blocks resolution | Pass | An already queued document can still be resolved after entitlement changes. |
| One cheque in a shared sheet resolves independently | Pass | Single-cheque APIs reject shared documents with rollback; the document API commits every cheque atomically. |
| A different profile is used after Ready validation | Pass | `READY` stores the exact profile ID; queueing any other profile is rejected. Referenced profiles are immutable. |
| Old schema-5 data cannot satisfy the new Ready binding | Pass | Printed/queued records recover the profile from immutable attempt evidence. Unprovable Ready-only records return safely to Draft with an audit entry. |
| Account, printer, stock, locale or currency is mixed | Pass | The plan and attempts bind all identities; account/country/currency/locale constraints are validated. |
| Text overlaps a protected field | Pass for engine geometry | Exact Helvetica metrics shrink only to the country floor and then refuse; unsupported glyphs fail before Ready. |
| Three-up output overwrites a used slot | Pass | `startSlot` 0/1/2 is explicit, bounded, and represented in the plan and evidence PDFs. |
| Deleted drafts, voids and misprints distort totals | Pass | Deleted, voided, spoiled, outstanding and cleared records are separate; reports group totals by currency. |
| Backups cannot move to another computer | Pass | Portable backups use a separate recovery passphrase and are verified after creation and before restore. |
| CSV or text input corrupts records | Pass | Bounds, row/column diagnostics, Unicode normalization, control/bidi rejection, dedupe, BOM, account/currency columns and safe/raw modes are tested. |
| French Canadian output is partly English | Pass for engine output | `fr-CA` cheque words, sample furniture, calibration copy, errors and key parity are tested. |

## Independent final recheck

The evaluator re-ran schema 1–5 migrations, including printed records, Ready records without attempt evidence, and a Ready record with a previous `NOT_SENT` attempt. Exact calibration bindings were preserved whenever the historical attempt proved them; only an unprovable Ready-only record was conservatively demoted. Shared three-up single-check resolution rolled back completely, while document-level resolution committed all three records.

No reproducible backend blocker remained.

## External scope

This evaluation does not qualify the Windows renderer, native print dialog, Microsoft Store purchase/restore adapter, application accessibility, physical stock, printer registration, MICR, or financial-institution acceptance. Those remain explicit external release gates.
