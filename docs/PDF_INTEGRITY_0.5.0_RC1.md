# PDF integrity changes — 0.5.0-rc.1

All eight software-controlled PDF improvements are implemented and enforced by the release gate.

| # | Improvement | Implementation | Release evidence |
|---:|---|---|---|
| 1 | Correct Canadian date geometry | Date value moved to `(450, 54, 104, 14)`; localized format indicator is at y=72. Indicator ink ends 19.872 pt before the amount rectangle. | `pdf-integrity.ts`, Canadian matrix/golden pages |
| 2 | One renderer everywhere | `renderPdfArtifact` produces browser, saved-file, acceptance, sample, calibration, and production output. Adapters no longer lay out fields themselves. | Engine and Site renderer tests |
| 3 | Exact measured stock profiles | Voucher top/middle/bottom and three-up declare exact Letter origins and perforations. Each remains explicitly subject to physical stock confirmation. | `printing.test.ts`, 47-PDF matrix |
| 4 | Preview/production separation | Production is variable-data-only. Simulated borders, labels, date indicators, signature lines, and sample marks exist only in preview mode. | Sparse-production assertions and extracted-text gate |
| 5 | Hardened PDF files | Exact Letter page boxes, zero rotation, PDF 1.7, embedded approved font subsets/Unicode maps, viewer print-scaling preference, no active content, plan hash, and final-PDF SHA-256. | In-process inspector plus Poppler `pdfinfo`, `pdffonts`, and `pdftotext` |
| 6 | Professional calibration | Inch/mm grid, 100% Actual Size instructions, printer/account/stock binding, safe global/per-field/stub offsets, and measured-error conversion to half-point correction. | Calibration tests and golden calibration page |
| 7 | Comprehensive PDF matrix | US/USD/en-US and Canadian CAD/USD in en-CA/fr-CA across all four layouts, plus boundary-content refusal. | 47 generated PDFs and `pdf-matrix.test.ts` |
| 8 | Visual regression | Five representative pages render at 300 DPI and must match approved images exactly. | `test:pdf-visual`: zero changed pixels |

## Locked commands

```text
npm run validate:gates
npm run verify:pdf -- --replace
npm run test:pdf-visual
```

`validate:gates` runs the other two commands in addition to typechecking, the full coverage suite, and package inspection.

## Honest remaining external checks

Software can guarantee PDF geometry and byte integrity, but it cannot certify an unknown printer or cheque stock. Before advertising compatibility with a named SKU or printer, print the calibration and sample at Actual Size, measure it against that supplier's template, confirm the preprinted MICR/bank/security elements, and complete any supplier or financial-institution qualification required for the target country.
