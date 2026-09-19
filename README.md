# WorksBien Check Printer Engine

Candidate 0.5.0-rc.1 is the local-first TypeScript backend and locked PDF renderer for a Microsoft Store check-printing app. It produces deterministic, country-aware US Letter `PrintPlan` objects and exact PDF bytes that a Windows host can save or send unchanged to a physical printer. It contains no bank connection, cloud service, or printer submission code.

## Supported backend flow

1. Choose the bank jurisdiction separately from USD/CAD, select `en-US`, `en-CA`, or `fr-CA`, and confirm the next number shown on its preprinted stock.
2. Create or import a payee; create, duplicate, or generate a draft from a saved payment favourite.
3. Choose an account-bound calibration profile and explicitly confirm its printer and stock identifiers.
4. Queue through `EncryptedStateStore.queuePrintDurably(...)`; it saves the queued state before returning the plan to the host.
5. Render the plan once with `renderPdfArtifact`; use the same exact PDF bytes for preview, Save as PDF, and the native 100% / Actual Size print path.
6. Record one customer-visible outcome through `resolvePrintDocumentOutcome`: printed correctly, paper marked with a problem, or nothing printed. “Nothing printed” is accepted only with trusted host evidence that the job was cancelled before submission or produced no output. A multi-cheque sheet commits as one atomic document outcome.
7. Replace spoiled stock with `replaceMisprinted`; the original number is voided and the replacement receives a new number. If an uncertain result is later verified, `confirmMisprintedAsPrinted` corrects it without issuing a replacement.
8. Search/filter/sort the register and export the same selection as UTF-8-BOM CSV or a structured report for host PDF rendering.

## Core guarantees

- Exact integer-cent accounting and cheque-safe English/Canadian-French amount words for USD/CAD.
- Voucher-top, voucher-middle, voucher-bottom, and three-up preprinted layouts, including a caller-supplied three-up `startSlot` and persistent physical sheet/slot ledger.
- Production geometry is fixed at 100%. Registration uses protected-area-checked global offsets plus independent half-point field and voucher-stub offsets.
- One shared preview/production PDF renderer, embedded subsetted WorksBien Sans (Liberation Sans) fonts with exact matching metrics, country-specific minimum sizes, and refusal when content or a glyph cannot print safely. Ready state is bound to the exact profile that passed this preflight.
- Exact 612 × 792 pt MediaBox/CropBox/TrimBox, zero rotation, `/PrintScaling /None`, embedded Unicode maps, and SHA-256 evidence for both the queued plan and final PDF bytes.
- Strict preview/production separation: sample furniture and watermarks never enter a live production PDF.
- Canadian preview dates have the required label/pattern and at least 18 pt (0.25 in) clear space before the convenience-amount rectangle.
- Immutable check snapshots for account/payee history plus immutable plan-hash, printer, stock, calibration and document evidence on print attempts.
- Immutable per-cheque language snapshots, Canadian French production output, and complete localization-key parity.
- Local payment favourites and Duplicate previous always create a new numbered draft; no unattended payment scheduling.
- A profile cannot be edited after any attempt uses it; create a new profile for a revised calibration.
- Three live checks in Free mode. Only host-proven `NOT_SENT` is refundable; confirmed/uncertain output is not. A fresh-device restore has dedicated explanatory copy instead of claiming three cheques were used.
- Unique numbers per account, redundant encrypted high-water guards (one beside the data and one in a separate local application-data directory), non-rollbackable three-up slot events, optimistic revision checks, atomic saves, and token-isolated heartbeat owner locks with an explicit confirmed break-lock recovery action. If the authoritative guard is missing, printing stays blocked until the physical next number is confirmed.
- Fresh-device restore conservatively exhausts the Free allowance and blocks issuing or queueing until the user confirms the next physical stock number.
- AES-256-GCM persistence, asynchronous PBKDF2-SHA256 at 600,000 iterations for state-store operations, separate backup passphrases, verified backups, and schema migration.
- Append-only hash-chained audit history bound to the complete current state.

## Run it

Requires Node.js 24 or later. Runtime code has no third-party dependencies; development type-checking uses the pinned packages in `devDependencies`.

```bash
npm install
npm test
npm run typecheck
npm run validate:gates
npm run harness -- demo
npm run harness -- amount 1234.56 USD
npm run acceptance -- --outcome printed
npm run scenarios
npm run verify:pdf -- --replace
npm run test:pdf-visual
```

For a laptop test with actual PDFs, encrypted persistence, backup verification, register export, and all three print outcomes, see `TESTING.md` or double-click `RUN-BACKEND-ACCEPTANCE.cmd` on Windows.

Current verified result: 81/81 tests; 98.61% lines, 86.13% branches, and 95.53% functions. The suite includes the country/currency/locale/stock PDF matrix, boundary-content refusal, redundant-guard folder rollback, a 100-cycle break/reacquire heartbeat race, asynchronous key derivation, normalized and rollback-resistant physical three-up sheet slots, trusted print outcomes, Canadian-French USD designation, 10,000 deterministic lifecycle sequences, and 100,000 generated CSV cases. `npm run validate:gates` executes typecheck, the coverage-threshold suite, the 47-PDF structural gate, exact 300-DPI golden-image comparison, and a package-inventory scan that rejects runtime or secret-bearing artifacts.

## Repository map

- `src/`: engine, print layout, persistence, CSV, localization, and CLI.
- `harness/`: backend-only acceptance runner, complete scenario matrix, and a thin file-system adapter over the shared renderer.
- `tests/`: unit, integration, recovery, crash-lock, and deterministic stress tests.
- `docs/PRODUCT_CONTRACT.md`: normative behavior and host obligations.
- `docs/NORTH_AMERICAN_CHEQUE_LAYOUT.md`: standards sources, safe-area measurements, and implemented field coordinates.
- `docs/RELEASE_GATE.md`: current backend and external gate status.
- `docs/CUSTOMER_EVALUATION.md`: independent customer-risk recheck.
- `docs/CODE_BREAKER_REVIEW.md`: independent final reliability review.
- `gate-manifest.json`: machine-readable evidence map.

## Status

**ENGINE AND PDF SUBSYSTEM READY FOR EXTERNAL VERIFICATION.** Candidate 0.5.0-rc.1 locks all software-controlled PDF improvements: corrected Canadian date clearance, one renderer, explicit measured stock profiles, preview/production separation, embedded fonts and PDF integrity evidence, ruler-driven calibration, a comprehensive matrix, and pixel-exact visual regression. The Windows shell, Microsoft Store receipt adapter, accessibility/UI evidence, physical stock, printer registration, and financial-institution qualification remain external gates.
