# US and Canada spacing/alignment acceptance checklist

Candidate: 0.5.0-rc.1  
Review mode: two independent country reviewers, PDF rendering, coordinate extraction, source inspection, and regression tests.

Review verdicts:

- **United States shared cheque geometry: APPROVED.** The field template retains its prior measurable software/PDF approval; the new voucher positions pass automated geometry tests.
- **Canada shared cheque geometry: APPROVED.** The field template retains its prior measurable software/PDF approval; the new voucher positions pass automated geometry tests.
- **Voucher-middle/bottom physical orientation: PROVISIONAL.** Exact stock SKU, perforation, printer registration, and Canadian voucher-orientation acceptance remain external.
- **External qualification remains open.** Neither approval claims certification of physical stock, MICR encoding, printer registration, or acceptance by a financial institution.

## Shared checklist

- [x] Letter page is exactly 612 × 792 pt.
- [x] Voucher cheque is 612 × 252 pt; the bottom 45 pt is protected for MICR.
- [x] Production plans and non-negotiable sample furniture draw no variable data, rules, fills, or frames through the MICR band.
- [x] Date, numeric amount and printed cheque number share x=554 as their right edge.
- [x] Payee ends at x=422, leaving 1 pt of tolerance before the Canadian amount/dollar-sign clear area begins at x=423.
- [x] Preview signature and memo rules are y=200, 7 pt above the MICR band; production stock furniture remains external.
- [x] Sample marker is pale, 10 pt, top-centred, and does not overlap payment fields.
- [x] Live production plans contain no sample marker or preview furniture.
- [x] Voucher values start at x=20 and at y=86 relative to each voucher section; top/middle/bottom absolute baselines are verified from the shared stock-layout table.
- [x] Exact embedded-font metrics and one renderer are shared by planning, browser preview, saved PDF, and portable evidence.
- [x] Live PDFs and previews are separate renderer modes; only preview mode contains stock furniture or a watermark.
- [x] Exact Letter page boxes, zero rotation, embedded font subsets/Unicode maps, no active content, and `/PrintScaling /None` are structurally inspected.
- [x] The immutable plan hash and final PDF SHA-256 are returned to the host.
- [x] Forty-seven matrix PDFs pass structural/text extraction checks and five representative pages match approved 300-DPI golden images pixel-for-pixel.
- [x] Unsupported PDF glyphs fail before queueing rather than being replaced silently.
- [x] Calibration cannot move text into MICR or amount protected areas.
- [x] Production scale is fixed at 100%; global offsets, six independent field offsets, and two independent stub offsets cannot bypass protected-area, collision, or section-bound checks.

## United States checklist

- [x] Built-in US template is USD-only.
- [x] Date is upper-right and may use `MM/DD/YYYY` to match the stock.
- [x] Payee is upper-middle left; memo is lower-left.
- [x] Numeric amount remains inside the convenience-amount box.
- [x] Legal-amount fill may appear on both sides of the words.
- [x] Three-up starting slot is explicit and prevents overprinting a used position.
- [x] Voucher-top, voucher-middle, and voucher-bottom each use one immutable cheque origin and reject non-zero starting slots.

## Canada checklist

- [x] Cheque is inside the Standard 006 size range.
- [x] `DATE` is at least 8 pt and the 6 pt format indicators appear below the automated date, with 19.872 pt of measured clearance before the amount rectangle.
- [x] Canadian automated dates use `YYYY-MM-DD`; slash formats are rejected.
- [x] Convenience-amount box is 110 × 30 pt inside the business scan area.
- [x] Clear area is 18 pt / 0.25 in around the box.
- [x] One 10 pt `$` appears adjacent to preview furniture, outside the rectangle; production variable data is digits-only.
- [x] Software-filled cheque fields use a 10 pt minimum after final printer scaling.
- [x] Legal-amount asterisks appear only before the words.
- [x] Canadian USD is independent from jurisdiction and appends `U.S. Funds` after legal `Dollars`.
- [x] Voucher rows identify `CAD` or `USD` explicitly.

## Evidence commands

```text
npm test
npm run validate:gates
npm run acceptance -- --country US --currency USD --outcome printed
npm run acceptance -- --country CA --currency CAD --outcome printed
npm run acceptance -- --country CA --currency USD --outcome printed
npm run verify:pdf -- --replace
npm run test:pdf-visual
```

## External conditions—not waived

- [ ] Compare the PDF against the exact preprinted stock SKU and supplier template.
- [ ] Verify 100% / Actual Size through the intended Windows PDF/print path.
- [ ] Qualify paper, toner, contrast, MICR encoding and bank identity already present on the stock.
- [ ] Submit pre-production Canadian samples to the financial institution as recommended by Payments Canada.
- [ ] Obtain any licensed ANSI X9 dimension tables or vendor qualification needed for a specific US compatibility claim.

The software checklist can pass completely while these physical/vendor checks remain pending. The app must say “measured test template” or “overprint on compliant preprinted stock,” never “bank certified.”

Canadian voucher orientation is stock-dependent: Standard 006 recommends that a detachable voucher be attached above or to the left of the payment item. Voucher-top, -middle, and -bottom are therefore software stock geometries, not a claim that every orientation is universally preferred or accepted in Canada. Any Canadian physical SKU remains supplier/FI-qualified before it can be advertised.
