# Laptop acceptance test

This package tests the WorksBien 0.5.0-rc.1 engine and PDF-integrity candidate without a physical printer or finished UI. It creates actual US Letter PDFs plus the exact `PrintPlan` JSON and SHA-256 evidence used to place every field.

## Fastest Windows test

1. Install Node.js 24 or later.
2. Extract this ZIP to a normal folder.
3. Double-click `RUN-BACKEND-ACCEPTANCE.cmd`.
4. Open the output folder printed at the end.
5. Inspect `01-calibration.pdf`, `02-non-negotiable-sample.pdf`, and `03-live-check.pdf`.
6. If you want to exercise the Windows print path, open `03-live-check.pdf`, choose **Microsoft Print to PDF**, set scale to **100% / Actual size**, turn off **Fit** or **Shrink**, and save a second PDF.

The script passes only after it reloads the encrypted state, verifies the backup, exports the register, and records the selected print outcome.

## Test with your own sample

Open Command Prompt in the extracted folder and run:

```text
npm run acceptance -- --country US --currency USD --amount 1234.56 --payee "Your Sample Payee" --memo "Invoice 1042" --date 2026-09-18 --check-number 1001 --outcome printed
```

For Canadian CAD, use `--country CA --currency CAD`. Canadian USD is `--country CA --currency USD` and adds `US FUNDS`.

Every run uses a new timestamped output folder unless you pass `--out <folder>`. The output folder must not already exist, which prevents a test run from overwriting earlier evidence.

## Exercise all three print outcomes

Run each command separately:

```text
npm run acceptance -- --outcome printed
npm run acceptance -- --outcome not-sent
npm run acceptance -- --outcome unknown
```

Expected final statuses:

| Outcome | Meaning | Final status |
|---|---|---|
| `printed` | PDF/output was produced correctly | `PRINTED` |
| `not-sent` | Nothing reached a printer or PDF target | `READY` |
| `unknown` | Output may exist; do not reuse the number | `MISPRINTED` |

## What to inspect

- `result.json`: overall `PASS`, final status, number progression, persistence/backup verification, and reconciliation totals.
- `03-live-check.pdf`: the human-visible output.
- `03-live-check.plan.json`: the exact backend coordinates, text, font sizes, printer key, stock key, and document ID.
- `register.csv`: Excel-compatible register export.
- The runner verifies encrypted persistence and an independent recovery backup, then removes those transient fixed-secret test files. Only inspectable PDF, plan, register, and result evidence remains.

## Automated suite

Run:

```text
npm install
npm test
npm run typecheck
npm run validate:gates
npm run scenarios
npm run verify:pdf -- --replace
npm run test:pdf-visual
```

`npm run scenarios` creates a new timestamped `output/verification-0.5.0-rc.1-.../` folder and never overwrites an earlier run. Pass `--out <empty-folder>` when you need a stable evidence path. It renders live and non-negotiable sample PDFs for voucher top, middle, bottom, and three-up layouts across US English/USD, Canadian English/CAD, Canadian French/CAD, Canadian French/USD, and Canadian English/USD, plus a localized calibration sheet for each path. It also renders three-up sheets beginning at the middle and bottom positions, resolves multi-check sheets atomically, exercises favourites, report currencies, entitlement validation, Ready-stage fit rejection and encrypted persistence, then removes transient state/backup files and writes `result.json`, `workflow-result.json` and `sha256-manifest.json`.

The acceptance adapter and browser test site are thin adapters over the same renderer and embedded-font metrics. `verify:pdf` checks 47 documents structurally; `test:pdf-visual` requires zero changed pixels against five approved 300-DPI pages. This is sufficient for backend/PDF inspection. Physical-stock and financial-institution qualification still require the intended Windows output path and real stock.
