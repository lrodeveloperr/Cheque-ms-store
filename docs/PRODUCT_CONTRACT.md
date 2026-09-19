# Product contract

Owner: WorksBien  
Candidate: 0.5.0-rc.1  
Scope date: 2026-09-19

## Job to be done

Let a small business or household generate an accurate PDF or physical print plan for an occasional check on preprinted stock, keep an honest local register, and recover safely from cancellation, uncertain output, spoiled stock, concurrent sessions, or damaged data—without an account, advertising, subscription, or bank connection.

## Normative workflow

1. Create a US or Canadian bank account, choose its USD/CAD currency and `en-US`, `en-CA`, or `fr-CA` language, and record the next number physically printed on its stock. Bank jurisdiction and currency are separate; the US template is USD-only, while Canada supports CAD or explicitly marked USD.
2. Create/import a payee and create a draft. The check captures immutable account/payee/language snapshots; later master-record edits affect future checks only. Frequently repeated payments can be saved as a local favourite or duplicated into a new numbered draft.
3. Choose voucher-top, voucher-middle, voucher-bottom, or three-up stock and calibrate its printer/account/stock profile. Production geometry is fixed at 100%/Actual Size; global and per-field point offsets correct registration without squeezing the cheque.
4. Mark the draft ready; this performs the selected stock/font/fit validation before the state can change. Call `queuePrintDurably` with matching printer and stock keys. Voucher layouts accept one cheque at slot zero; three-up stock also accepts the first unused slot.
5. The host passes the returned `PrintPlan` to `renderPdfArtifact` once, then uses those exact PDF bytes for preview, Save as PDF, or the native Windows print path. A live job uses production mode; sample and calibration documents use preview mode.
6. Record exactly one result for the immutable document hash: printed correctly, printed/possibly printed with a problem, or nothing printed. Every cheque in a multi-cheque document commits atomically.
7. Nothing printed returns the check to `READY`. Uncertain output becomes `MISPRINTED`. A replacement voids the spoiled number, allocates the next number, and links both records.
8. Mark printed checks cleared/not cleared using a local `YYYY-MM-DD` calendar date. Search/filter/sort the register and export the same ordered selection as localized UTF-8-BOM CSV or a structured report suitable for host PDF rendering.
9. Save locally with a Windows-protected live secret. Create portable backups using a different recovery passphrase.
10. After fresh-device restore, confirm every account's next physical stock number before issuing or queueing. The Free trial is conservatively treated as exhausted because post-backup use cannot be proven absent.

## Atomic requirements

| ID | Scope | Requirement | Risk | Test evidence |
|---|---|---|---|---|
| REQ-MNY-001 | Launch | Store positive money as integer cents from 0.01 through 999,999,999.99. | High | `money.test.ts`, `stress.test.ts` |
| REQ-MNY-002 | Launch | Render cheque-safe English and Canadian French amount words and `NN/100` for USD/CAD without floating point. | High | `money.test.ts`, `printing.test.ts`, `completeness.test.ts` |
| REQ-CHK-001 | Launch | Keep `(accountId, checkNumber)` unique and never silently reuse a number. | High | `engine.test.ts`, `persistence.test.ts` |
| REQ-CHK-002 | Launch | Enforce the draft/ready/queued/printed lifecycle and three explicit print outcomes atomically, including all checks sharing one document. | High | `engine.test.ts`, `stress.test.ts` |
| REQ-CHK-003 | Launch | Treat output as printed only after the document ID and SHA-256 plan hash match; allow confirmation after entitlement changes. | High | `engine.test.ts`, `host-contract.test.ts` |
| REQ-CHK-004 | Launch | Keep immutable account/payee snapshots and prohibit payment edits after draft state. | High | `engine.test.ts` |
| REQ-TPL-001 | Launch | Save, edit, archive, clear a fixed amount, and reuse manual payment favourites; duplicate an existing non-deleted cheque only as a newly numbered draft and apply payee default memos. | Medium | `completeness.test.ts` |
| REQ-PRN-001 | Launch | Produce deterministic country-aware US Letter plans while preserving the amount clear area and physical MICR band. | High | `printing.test.ts`, `docs/NORTH_AMERICAN_CHEQUE_LAYOUT.md` |
| REQ-PRN-002 | Launch | Support voucher-top, voucher-middle, voucher-bottom, and three-up stock while preserving explicit three-up starting slots. | High | `printing.test.ts` |
| REQ-PRN-003 | Launch | Bind account, printer, stock, calibration identity, layout, and plan hash to each attempt. | High | `engine.test.ts`, `printing.test.ts` |
| REQ-PRN-005 | Launch | Lock production geometry to 100%; allow bounded independent cheque-field and voucher-stub X/Y offsets while rejecting page, MICR, convenience-amount, and field collisions. | High | `printing.test.ts`, `persistence.test.ts` |
| REQ-PDF-001 | Launch | Use one deterministic renderer with exact Letter boxes, embedded approved font subsets/Unicode maps, fixed zero rotation and no active content. | High | `pdf-renderer.test.ts`, `pdf-matrix.test.ts` |
| REQ-PDF-002 | Launch | Keep production variable-data-only, keep simulated stock/watermarks preview-only, and return both immutable plan and final-PDF SHA-256 evidence. | High | `pdf-renderer.test.ts`, `verify-pdf-integrity.ts` |
| REQ-PDF-003 | Launch | Gate all country/currency/locale/stock combinations and boundary content, plus representative 300-DPI golden images. | High | `pdf-matrix.test.ts`, `verify-pdf-visuals.ts` |
| REQ-AUD-001 | Launch | Hash-chain every committed mutation and bind the terminal entry to complete state. | High | `engine.test.ts` |
| REQ-DAT-001 | Launch | Use AES-256-GCM and PBKDF2-SHA256/600,000; distinguish wrong passphrase from authenticated-file damage. | High | `persistence.test.ts` |
| REQ-DAT-002 | Launch | Use atomic save, expected revisions, token-isolated heartbeat owner locks, confirmed break-lock recovery, temp promotion, semantic validation, and redundant guards outside the restorable data folder for number/Free high water plus ordered three-up slot events. A missing authoritative guard requires physical number confirmation. | High | `persistence.test.ts` |
| REQ-CSV-001 | Launch | Bound CSV input; report row/column; deduplicate imports; export BOM/account/localized status and formula-safe cells with explicit raw mode. | High | `csv.test.ts`, `engine.test.ts`, `stress.test.ts` |
| REQ-ENT-001 | Launch | Allow three distinct Free checks; refund `NOT_SENT` only with trusted host no-delivery evidence; do not roll usage back through restore; use dedicated conservative-restore copy; accept Lifetime only from Microsoft Store or explicit test evidence. | High | `engine.test.ts`, `persistence.test.ts` |
| REQ-REC-001 | Launch | Separate outstanding, cleared, voided, spoiled, and deleted-draft amounts/counts. | Medium | `engine.test.ts` |
| REQ-REC-002 | Launch | Filter and deterministically sort register rows, keep replaced misprints in the spoiled bucket, produce matching CSV/report selections, separate all totals by currency, and state that cheque totals are not a bank balance. | Medium | `register.test.ts`, `completeness.test.ts`, `engine.test.ts` |
| REQ-LOC-001 | Launch | Externalize host-facing `en-US`, `en-CA`, and `fr-CA` strings with identical non-empty key sets. | Medium | `localization.test.ts` |
| REQ-FR-001 | Launch | Freeze each cheque's language and render Canadian French sample text, numeric amounts, and amount words without changing historical cheques after an account-language edit. | High | `money.test.ts`, `completeness.test.ts` |
| REQ-HST-001 | Launch | Give the host an exact Letter/100%/no-fit job whose content is verified against the queued plan hash, plus one atomic document-level three-outcome API. | High | `host-contract.test.ts`, `engine.test.ts`, `completeness.test.ts` |
| REQ-PRN-004 | Deferred | Verify that the Windows shell saves/sends the shared renderer's exact PDF bytes and preserves Letter/Actual Size through Microsoft Print to PDF and a physical printer. | High | Host integration |
| REQ-MIC-001 | Excluded | Print MICR/routing/account fields on blank stock. | Critical | N/A |
| REQ-CLD-001 | Excluded | Cloud sync, telemetry, ads, or mandatory account. | High | N/A |

## State and recovery invariants

- Rejected operations leave the complete state, revision, and audit unchanged.
- A draft soft-delete keeps its number but is excluded from financial reconciliation.
- `PRINT_QUEUED` has exactly one queued latest attempt. `PRINTED` has a confirmed latest attempt. `MISPRINTED` has a spoiled latest attempt. One document-level result changes every still-queued check with that document/hash in one rollback-safe mutation.
- `NOT_SENT` may be retried and does not consume Free usage only when the host proves cancellation before submission or confirms no output. `UNKNOWN`, confirmation, and any rolled-back queued plan conservatively consume it.
- Replacement checks are linked reciprocally and do not consume a second Free slot.
- Existing-destination restore merges number and Free-use high-water marks. A retained identical queued attempt remains resolvable/refundable.
- Fresh-destination restore sets `RESTORE_CONFIRMATION_REQUIRED`; both draft creation and live queueing are blocked until `confirmNextCheckNumber` succeeds.
- Account/payee archival affects future drafts. It does not silently cancel an already-ready check; its immutable snapshots remain authoritative.
- Account-language edits affect future drafts only. Every draft stores its own supported locale, and one print plan cannot mix languages.
- A payment favourite never reserves a cheque number. Creating or duplicating from it uses the normal draft-number reservation rules.
- Ready state stores the exact calibration profile that passed render preflight. Queueing with any other profile is rejected until the cheque returns to Draft and is marked Ready again.
- A calibration profile becomes immutable while a Ready cheque references it and after its first attempt. Revised calibration requires a new profile.
- Every production profile uses `scalePercent = 100`. Global offsets remain within ±36 pt. Each cheque field and each voucher stub has an independent X/Y offset, stored in 0.5 pt steps and bounded to ±18 pt; unsafe combinations are rejected atomically.
- Schema 1–6 records migrate to schema 7 with 100% calibration scale, zero local offsets where required, conservative Free-use provenance, and an empty physical-sheet ledger. Schema-5 printable records recover the exact profile from attempt evidence; a schema-5 `READY` record with no attempt is conservatively returned to `DRAFT`. Every migration is audit-bound and does not reinterpret historical print-plan hashes.
- All printable elements stay inside 612 × 792 points, outside protected areas; text exceeding the country-specific minimum safe font size or unavailable in the PDF font is rejected before a draft can become Ready and rechecked at queueing.
- Issue and cleared dates are local calendar dates (`YYYY-MM-DD`). Audit/storage timestamps are canonical UTC ISO instants.

## Host contract

- Acquire and retain `EncryptedStateStore.acquireInstanceLock` for the application's ownership of a data file.
- Await `queuePrintDurably` before exposing a printable document.
- Call the shared renderer; do not re-layout the plan in browser, WinUI, or printer-specific code. Preserve and audit the returned PDF SHA-256.
- Construct an `ExactPrintJob` with the durably queued plan hash; keep Letter paper, 100% scale, and `fitToPage = false` through both PDF and native paths.
- Supply the bank jurisdiction, currency, printer key and locked stock key; do not infer jurisdiction from a shared dollar sign or currency.
- Map native outcomes to printed correctly, printed/unknown, or nothing printed and resolve the entire document once, never one cheque at a time.
- Keep the live storage secret in Windows-protected storage. Ask the user for a separate backup passphrase.
- Localize `DomainError.messageKey`; never display `developerMessage` directly.

## Exclusions

No bank connectivity, check clearing network, MICR generation, payroll, cloud sync, unattended scheduled payments, telemetry, advertisements, or subscriptions is present. USD/CAD selection remains required because wording, numeric formatting, date defaults, records, and future integrations differ even though both use `$`.
