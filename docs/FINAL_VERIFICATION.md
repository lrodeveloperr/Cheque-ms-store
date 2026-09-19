# Final verification

Candidate: 0.4.0-rc.1  
Date: 2026-09-19  
Scope: TypeScript backend/domain engine and portable PDF evidence

## Verdict

**ENGINE READY FOR EXTERNAL VERIFICATION — Windows, Store, accessibility and physical-stock gates remain open.**

All 76 automated tests pass on Node 24.19.0 with 98.57% line, 86.26% branch, and 95.26% function coverage. The suite also completes 10,000 deterministic lifecycle sequences and 100,000 generated CSV cases. It directly covers whole-folder rollback, missing authoritative guards, PID reuse, a 100-cycle break/reacquire heartbeat race, asynchronous key derivation, legacy terminal-state tampering, trusted no-output evidence, normalized and restore-resistant three-up physical slots including equal-timestamp outcomes, Canadian-French CSV conventions, French amount grammar, and the mandatory `dollars US` designation on Canadian USD French cheques.

The earlier independent customer evaluation found immutable-document, entitlement, evidence, reporting, batch-resolution and Ready-state gaps. Each reproduced gap now has a regression test or scenario-harness check. A fresh independent reliability review is recorded in `CODE_BREAKER_REVIEW.md`.

- The original recovery/security findings remain closed.
- The 0.4.0 review findings are closed by queued-plan hash verification, entitlement source validation, current PDF evidence, an executable scenario matrix, consistent spoiled-stock classification, per-currency totals, atomic document outcomes, Ready-stage render validation, clearable favourite amounts and jurisdiction-bound sample locales.

## Audit-remediation result

| Area from independent audit | Result |
|---|---|
| Restore number reuse and pre-restore safety | Closed |
| Concurrent writers and crashed locks | Closed |
| Newer valid temp promotion | Closed |
| Three print outcomes and entitlement lapse | Closed |
| Calibration patch allowlist/atomicity | Closed |
| Account/printer/stock isolation | Closed |
| Replacement number allocation | Closed |
| Text-fit refusal and memo cap | Closed |
| Three-up starting slot | Closed |
| Reconciliation categories | Closed |
| Portable backup, separate passphrase, 600k KDF | Closed |
| Account/payee edit/archive/number confirmation | Closed |
| Unicode/control/single-line validation | Closed |
| Date warnings and local cleared date | Closed |
| CSV BOM/account/safety/aliases/dedupe | Closed |
| Real migration time | Closed |
| Per-field localized language | Closed |
| Immutable queued-plan identity | Closed |
| Entitlement kind/source matching | Closed |
| Atomic multi-cheque document outcome | Closed |
| Mixed-currency report totals | Closed by per-currency grouping |
| Replaced-misprint report classification | Closed as spoiled across register/report/CSV/reconciliation |
| Ready-stage font and fit validation | Closed |
| Candidate-version scenario/PDF evidence | Closed after regeneration from schema 7; encrypted workflow state and backups are excluded from the distributable evidence set |
| Pre-profile-binding schema migration | Closed; schema 1–5 migration matrix independently rechecked |
| Legacy migration terminal-state binding | Closed; schema 1–3 tampering is rejected before migration |
| Break-lock heartbeat replacement race | Closed with immutable owner records and token-specific heartbeat sidecars |
| Restore/whitespace three-up slot reuse | Closed by normalized IDs and the out-of-folder slot-event guard |
| Secret-bearing package inventory | Closed by runner cleanup, `.npmignore`, and an executable npm-pack gate |

## Boundary of this verdict

This proves domain behavior, deterministic print-plan geometry and the portable PDF adapter. It does not claim that a WinUI renderer, native Windows print dialog, Microsoft Store receipt adapter, accessibility layer, physical printer/stock, MICR line or financial-institution acceptance has been implemented or qualified. External integration must preserve the documented plan hash and document-level outcome invariants.
