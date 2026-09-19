# North American cheque layout baseline

Status: implemented and independently re-reviewed for PDF geometry. This is a measured overprint template for compliant preprinted stock, not a claim that a PDF alone is bank-certified.

## Authoritative basis and limit

- [Payments Canada Standard 006](https://www.payments.ca/sites/default/files/standard006eng.pdf) controls the Canadian dimensions used here: cheque size, bottom 5/8-inch MICR band, business convenience-amount scan area, amount rectangle and clear area, date label/indicators, legal-amount fill, and Canadian USD designation.
- U.S. placement is governed by [ANSI X9.100-110](https://webstore.ansi.org/standards/ascx9/ansix91001102021) and [ANSI X9.100-160-1](https://webstore.ansi.org/standards/ascx9/ansix91001602021). Their complete licensed dimension tables are not reproduced in this project.
- The [Federal Reserve Check 21 FAQ](https://www.federalreserve.gov/paymentsystems/regcc-faq-check21.htm) explains the legal status of substitute checks and MICR requirements.

WorksBien does not generate a MICR line, bank identity, security paper, or blank-stock cheque. Its production PDF contains variable data only and must be overprinted at 100% / Actual Size on compliant stock. A stock supplier and the financial institution must qualify any real negotiable-cheque claim.

## Locked test templates

Coordinates are PDF points from the top-left of US Letter; 72 points equal one inch.

| Template | Key | Geometry |
|---|---|---|
| Voucher top | `WB-VOUCHER-TOP-LETTER-3.5-3.5-4.0` | 612 × 252 pt cheque, then two voucher sections; perforations at y=252 and y=504 |
| Voucher middle | `WB-VOUCHER-MIDDLE-LETTER-3.5-3.5-4.0` | 252 pt voucher, cheque origin y=252, then 288 pt voucher; perforations at y=252 and y=504 |
| Voucher bottom | `WB-VOUCHER-BOTTOM-LETTER-3.5-4.0-3.5` | 252 pt voucher, 288 pt voucher, then cheque origin y=540; perforations at y=252 and y=540 |
| Three-up | `WB-THREE-UP-LETTER-3.5-WITH-0.167-GAPS` | cheque origins y=0, 264, 528; 12 pt gaps |

The cheque’s protected MICR band is y=207–252 relative to each cheque origin. Production plans and non-negotiable sample furniture place no variable data, rules, fills, or frames in that band. Voucher-position dimensions are measured software templates; a supplier and financial institution must still confirm that a named physical stock uses the same perforations and orientation.

## Variable field geometry

| Field | Bounds `(x, y, width, height)` | Type rule | Alignment |
|---|---:|---|---|
| Cheque number | 505, 35, 49, 13 | 9 pt | right edge x=554 |
| Date | 450, 54, 104, 14 | 10 pt minimum | right edge x=554 |
| Payee | 83, 104, 339, 16 | 11 pt preferred; US floor 8 pt, Canada floor 10 pt | left; ends x=422 |
| Numeric amount | 455, 107, 99, 16 | 11 pt preferred; 10 pt floor | right edge x=554; vertically centred in the box |
| Legal amount | 45, 147, 515, 14 | 10 pt minimum | left |
| Memo | 72, 184, 245, 13 | US 9/7 pt; Canada 10 pt fixed floor | left |

The Canadian amount rectangle is x=450–560 and y=96–126. Its protected area includes the external dollar-sign glyph and extends left to x=423. The software prints digits only inside a Canadian amount rectangle; the preview furniture shows one vertically centred 10 pt `$` outside it with a 3.44 pt / 0.048 in gap. A real production PDF relies on the compliant stock’s preprinted dollar sign.

The payee, date, legal amount and memo use the earlier accepted upper-middle, upper-right, middle and lower-left rhythm. The preview signature and memo rules are y=200, leaving 7 pt before the MICR band. The date and numeric amount share right edge x=554.

## Country rules

- Bank jurisdiction is stored separately from currency.
- The US template supports USD.
- A Canadian bank account may use CAD or USD. Canadian English USD appends `U.S. Funds` immediately after `Dollars`; Canadian French uses `dollar US`/`dollars US`, an example expressly recognized by Standard 006.
- Canadian dates are forced to `YYYY-MM-DD`. The sample furniture prints `DATE` at 8 pt and localized indicators at 6 pt below the value: `Y Y Y Y M M D D` in English and `A A A A M M J J` in French. The indicator ink ends at y=76.128, leaving 19.872 pt before the amount rectangle begins at y=96; this exceeds the 18 pt / 0.25 in normal clear area.
- Canadian legal-amount asterisks appear only before the words. US fill may appear before and after.
- Voucher detail rows start at x=20. Each data baseline is 86 pt below its voucher-section origin: top uses y=338/590, middle uses y=86/590, and bottom uses y=86/338.
- Planning, browser preview, saved PDF, and portable harness use one renderer and exact metrics from the same embedded subsetted WorksBien Sans font files. Common US/Canadian Latin text is supported; unsupported glyphs are rejected when the payee is created, with the character and Unicode code point named instead of silently becoming `?`.

## PDF integrity contract

- PDF 1.7 with exact 612 × 792 pt MediaBox, CropBox, and TrimBox; rotation is fixed at zero.
- `/PrintScaling /None` and `/PickTrayByPDFSize true` are declared, while the host must still request Letter at 100% / Actual Size with no fit or shrink.
- Regular and bold WorksBien Sans subsets and Unicode maps are embedded; no host-font substitution is allowed.
- Live production output contains variable data only. Borders, labels, amount boxes, signature lines, date indicators, and sample watermarks are preview-only furniture supplied by the non-negotiable sample.
- Each rendered artifact records the immutable plan hash and SHA-256 of the final PDF bytes. The host must save or print those bytes unchanged.
- The 47-document release matrix and five 300-DPI golden pages are checked by `verify:pdf` and `test:pdf-visual`.

## Calibration safety

Production scale is locked to 100%. Global X/Y offsets remain bounded to ±36 pt. The check number, date, payee, numeric amount, legal amount, and memo each have an independent X/Y adjustment; the first and second voucher detail rows have separate adjustments. Local adjustments use 0.5 pt increments and are bounded to ±18 pt. A combination is accepted only if every transformed field:

- remains on the Letter page;
- stays out of the physical MICR band;
- keeps non-amount data out of the convenience-amount clear area; and
- keeps the numeric amount inside the stock rectangle;
- avoids another variable cheque field; and
- keeps each voucher row inside its own physical section.

`deriveCalibrationCorrection` accepts a measured horizontal/vertical ruler error in points, inches, or millimetres, reverses it into the necessary correction, and rounds to the supported half-point grid. This intentionally rejects many extreme combinations. Calibration corrects small printer drift; it does not make one template fit incompatible stock.

## Acceptance

The exact software/PDF checklist is in `US_CANADA_SPACING_ALIGNMENT_CHECKLIST.md`. The measurable layout can pass without a physical printer. Named-stock, toner, MICR and financial-institution approval remain external release gates.
