# 0.4.0-rc.1 hardening remediation

Verified 2026-09-19 on Node 24.19.0.

This pass addresses the independent regression report without changing the approved cheque-field geometry.

| Reported risk | Implemented control | Regression evidence |
|---|---|---|
| Data-folder rollback can roll back the number guard | The encrypted high-water guard is written both beside the data and to a path-keyed application-data directory. A missing authoritative guard forces physical-number confirmation. | Whole-folder rollback and missing-guard tests |
| PID reuse can create an unrecoverable lock | Locks record machine identity and process start. Heartbeats use token-specific sidecar files, so a broken owner's delayed heartbeat cannot overwrite or delete a replacement owner. Expired heartbeats are reclaimed, and a separate explicit `BREAK_LOCK` operation exists for confirmed recovery. Synced folders are not supported as live-data locations. | PID-reuse, heartbeat, active-lock, crash-lock, break-lock, and 100-cycle break/reacquire race tests |
| PBKDF2 blocks the application thread | Every `EncryptedStateStore` encryption/decryption path uses asynchronous PBKDF2. Synchronous helpers remain only for deterministic fixture construction and compatibility probes. | Event-loop-yield test |
| Fresh restore shows a false three-used message | State records `PORTABLE_RESTORE_CONSERVATIVE` separately and emits `entitlement.restoreConservative`. | Restore and localization tests |
| “Nothing printed” can be claimed repeatedly | A refund requires `HOST_CANCELLED_BEFORE_SUBMIT` or `HOST_CONFIRMED_NO_OUTPUT`. Three-up jobs also reserve named physical sheet slots and release them only on a trusted no-output outcome. | Trusted-outcome and sheet-ledger tests |
| Spoiled classification cannot be corrected | `confirmMisprintedAsPrinted` changes an unresolved spoiled result to Printed. Localized guidance tells the user to secure/destroy the original and consider a stop payment if it left their control. | Misprint-correction test and catalog parity test |
| Cleared dates are weak | Cleared dates must be real, on/after the issue date, and no later than the injected local current date. Issue-date warnings now mean more than one year from today. | Date-range tests |
| Unsupported glyphs fail late | Payee/default-memo creation, update, and CSV import reject unsupported glyphs immediately and identify the character plus Unicode code point. | Early-glyph test and parameterized localization test |
| Fit errors are generic | Payee, memo, numeric amount, and legal amount have field-specific fit keys. | Print-fit tests |
| French-Canadian CSV is awkward in Excel | `fr-CA` exports use semicolons and decimal commas. Import auto-detects comma/semicolon and can default the country from the selected account. Common French headers are accepted. | French-Canadian CSV test |
| Errors are chosen by English keyword matching | Keyword matching was removed. Errors now use explicit keys or deterministic code defaults, and catalog text supports typed parameters. | Localization regression test |
| French amount grammar is wrong before `mille` | Final `s` is removed from `cents` and `quatre-vingts` before `mille`; currency singular/plural and fraction order were corrected. | Boundary tests for 80,000 and 200,000 dollars |
| French sample date indicators are English | The sample uses localized `A A A A M M J J`. | PDF scenario evidence |
| Canadian USD French wording is ambiguous | The legal amount always retains `dollar US`/`dollars US`, even when optional currency labels are disabled. The wording follows an express Standard 006 example. | Canadian specialist recheck and production-plan test |
| Canadian date label is too small | Canadian sample furniture renders `DATE` at 8 pt. | PDF stream and visual inspection |
| Common French CSV headers are missed | Import accepts `Pays`, `Note`, and `Note par défaut`. | French alias tests |
| Legacy schema 1–3 migration can bless terminal-state tampering | Migration verifies the terminal audit state binding before transforming the legacy state. | Authenticated schema-2 tamper regression |
| Three-up IDs can bypass the ledger, and restore can roll slots back | Sheet IDs are normalized before uniqueness/ledger lookup. The separate encrypted guard stores ordered reservation/use/release events and reapplies them during supported restore. | Whitespace-ID and supported-restore slot regressions |
| Gate validator checks only manifest shape | `npm run validate:gates` now runs typecheck, the coverage-threshold suite, and `npm pack --dry-run` inventory validation after validating the manifest. | Gate command output |
| Fixed-secret encrypted files ship in evidence | Scenario and acceptance runners delete transient state, guard, lock, heartbeat, and backup files after verification. `.npmignore` and the executable package-inventory gate reject runtime/secret-bearing artifacts. Distributable evidence contains PDFs, plan JSON, summaries, CSV, and hashes only. | Package inventory check |

Final automated result: 76/76 tests; 98.57% lines, 86.26% branches, and 95.26% functions. Physical printer/stock qualification, Windows-host UI/accessibility, and Microsoft Store sandbox purchase restoration remain external gates.
