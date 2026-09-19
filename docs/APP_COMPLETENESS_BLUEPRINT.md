# WorksBien Check Printer — completeness blueprint

**Research date:** 2026-09-19  
**Product boundary:** Windows business-cheque overprinter and lightweight register for preprinted United States and Canadian stock  
**Recommended promise:** “Accurately print and track business checks on preprinted stock—privately, without an account or subscription.”

## Verdict

The backend is a strong domain engine, but the **sellable Windows application is not complete yet**. It becomes complete when a customer can install it, identify their stock, calibrate once, create and print a correctly aligned cheque, record the real print outcome automatically, recover safely from a mistake or reinstall, and understand the price before committing paper.

The best opportunity is not to duplicate the largest incumbent feature lists. Existing products advertise blank-stock MICR printing, deposit slips, generic template designers, bank imports, logos, cloud sync and accounting features, yet their weakest ratings and reviews repeatedly concern the basics: alignment, setup, printing one cheque, restoring a purchase, unclear payment, stale records and confusing workflows. WorksBien should win by making the narrow core unusually reliable.

The current engine already handles many of the hard invisible parts: exact money, numbering, immutable snapshots and plan hashes, atomic document outcomes, print states, misprint replacement, durable revisions, audit integrity, encrypted storage/backups, CSV safety, sample output, US/CAD rules, Canadian French, protected areas and deterministic PDFs. The remaining launch work is the Windows host and customer-facing workflow, Microsoft Store purchase restoration, accessibility, physical stock/printer qualification and real-world acceptance testing.

## What “complete” means

A launch build is complete only when all of these statements are true:

1. A new customer can produce a correctly positioned sample PDF in under five minutes without creating an account.
2. The app plainly states that it is for **preprinted stock** and shows which parts must already be on that stock.
3. The preview, saved PDF and printer output use the same immutable print plan and the same geometry.
4. Printing is always at Letter size and 100% / Actual size; “fit,” “shrink” and browser scaling never silently alter it.
5. The customer can correct alignment in measured 1-point increments without dragging fields into protected regions.
6. The app can safely handle the next remaining cheque on three-up stock and supported voucher-top, voucher-middle and voucher-bottom stock.
7. The customer records one of three outcomes: printed correctly, paper was marked but is wrong, or nothing printed. The last result is refundable only when the Windows host proves cancellation before submission or confirms no output.
8. The register updates automatically; it never depends on a separate Save action after printing.
9. Check numbers cannot be silently reused after a crash, concurrent launch, backup restore or misprint.
10. A reinstall can restore both customer data and a legitimate Lifetime purchase.
11. US English, Canadian English and Canadian French paths are complete and independently checked.
12. Every advertised printer/stock compatibility claim has been physically tested; anything untested is not advertised.

## Competitor baseline

The table uses live Microsoft Store descriptions and ratings. Review conclusions below also use public customer reviews from closely related iPhone/iPad products because the Microsoft listings expose ratings but not enough review text for a useful qualitative audit.

| Product | Useful baseline | Weakness or opening for WorksBien |
|---|---|---|
| [Print Checks Pro](https://apps.microsoft.com/detail/9nqltzq0s17z?hl=en-US&gl=US) | US/Canada accounts, preprinted and blank stock, personal/business sizes, 3-up and single checks, logos/signatures, favourites, categories, split transactions and backups | Public reviews of the same product family report poor alignment controls, confusing setup, single-check trouble, purchase restoration failures and surprise payment friction |
| [Simply Print Checks](https://apps.microsoft.com/detail/9nmplzjvfhm3?hl=en-US&gl=US) | Three-part business stock, saved vendors, categories, history, void/reprint, reports, CSV/Excel and adjustable layouts | Subscription model creates a clear opening for a transparent one-time, local-first alternative |
| [Check Print’R+](https://apps.microsoft.com/detail/9pdg0vdszrrc?hl=en-US&gl=US) | Fine 1/72-inch positioning, top/middle/bottom/three-up, movable/toggleable elements, signatures, register and reconciliation | Low Store rating; unrestricted movement and MICR/blank-stock modes increase setup and compliance risk |
| [Print Checks](https://apps.microsoft.com/detail/9ngr1sgcgfs8?hl=en-US&gl=US) | Wizard, preview, templates, signatures, backup/restore, check history, PDF output and a full template editor | Low rating and a complex editor; WorksBien can replace arbitrary design with safer guided calibration |
| [Print Checks Deluxe](https://apps.microsoft.com/detail/9nw3bvbr2zv1?hl=en-US&gl=US) | Business positioning, checkbook management and broad stock claims | Higher price and weak rating leave room for a smaller, better-tested product |
| [Check Writer & Printer](https://apps.microsoft.com/detail/9p15k9pb48t6?hl=en-US&gl=US) | Multiple templates, amount words, offline use and PDF/image output | Very weak rating; low price has not compensated for reliability concerns |
| [Checkbook Manager](https://apps.microsoft.com/detail/9ppjq6gjlmvl?hl=en-US&gl=US) | Strong register, batch entry, clearing, reconciliation, reports, recurring rules and bank CSV matching | This is a broader finance manager. WorksBien should not imply bank balance/accounting coverage unless it also models deposits and non-cheque transactions |
| [Just Checking](https://apps.microsoft.com/detail/9nxnp4gxwmfm?hl=en-US&gl=US) | Multi-account register, reconciliation, reports, imports, recurring transactions and editable templates | Broader and more complex; its feature set is a reference for future register expansion, not a launch requirement for a focused printer |

## What customer comments actually ask for

| Review signal | Product requirement |
|---|---|
| “Cannot align” or prints in the wrong place | Guided calibration, measured nudges, per-field correction, exact preview and a printable ruler/test sheet |
| Cannot print a single remaining cheque | Explicit top/middle/bottom slot selection and a visual stock-loading instruction before printing |
| Setup is confusing or a user cannot create an account profile | A short setup wizard with stock illustrations, safe defaults and no bank login/routing-data requirement |
| Purchase disappears after reinstall | Microsoft Store receipt restoration, offline grace, clear receipt state and a support recovery route |
| Price/paywall feels hidden | Show the three-live-cheque limit and Lifetime price before the first live print; samples remain free and visibly non-negotiable |
| Printed item does not appear in records immediately | Automatic register entry based on the confirmed print outcome; no manual Save step |
| Wants recurring rent or repeated payments | “Duplicate previous” and saved payment templates/favourites; automatic scheduling can wait |
| Wants a stored signature | Consider an optional encrypted signature in a later release, protected by Windows Hello/PIN and never enabled by default |
| Likes no login, local printing and fast first cheque | Preserve the no-account, local-only path and make first-run success a measured release criterion |
| Wants simple instructions | Embedded setup checklist, context help and a one-page “load stock / print Actual size / confirm outcome” guide |

Review sources: [Print Checks Pro reviews](https://apps.apple.com/us/app/1528800667?see-all=reviews&platform=iphone), [Check Writer: Print Checks reviews](https://apps.apple.com/us/app/998125538?see-all=reviews&platform=iphone), [USA Check Writer](https://apps.apple.com/us/app/usa-check-writer-printing/id1600995160), and [CA Cheque Writer](https://apps.apple.com/ca/app/ca-cheque-writer-printing/id1601065588).

## Launch-complete requirements (P0)

### 1. Windows host and exact output

- Package the application for Microsoft Store installation and clean uninstall.
- Enumerate Windows printers, remember the selected printer per calibration profile and detect when the device changes.
- Use one renderer for preview, PDF and native print so output cannot diverge.
- Freeze the output at US Letter, 612 × 792 points, and default production printing to 100% / Actual size.
- Detect or prominently warn about “Fit to page,” “Shrink oversized pages,” borderless modes and driver scaling.
- Complete durable queueing before opening the system print dialog.
- Map Windows outcomes to the engine’s three states; never assume that dismissing a dialog means nothing reached paper.
- Offer Print to PDF as a first-class test route that does not consume a live cheque when the document is a watermarked sample.

### 2. Honest preprinted-stock onboarding

Collect only:

- country: United States or Canada;
- currency: USD or CAD, subject to jurisdiction rules;
- account nickname;
- payor/company name and address for records;
- next physical cheque number;
- stock layout and printer.

Explain during setup:

- The app is not connected to the bank.
- Preprinted stock must already contain the bank identity, routing/account MICR line, cheque furniture and normally the company identity.
- The customer does **not** need ordinary company letterhead. Letterhead is not a substitute for bank-issued or compatible preprinted cheque stock.
- WorksBien overlays the date, payee, numeric amount, legal amount, memo and optionally the physical cheque number. It must not duplicate static stock content.
- A screen preview may simulate the stock background for orientation, but the production print layer must show exactly which marks the app will add.

### 3. Supported stock layouts

Launch support should include:

- business voucher cheque at top;
- business voucher cheque in middle;
- business voucher cheque at bottom;
- three business cheques per Letter page;
- start-at-top, start-at-middle and start-at-bottom handling for partially used three-up stock.

Every layout needs its own immutable template, safe regions, default coordinates, calibration profile and golden PDF. Do not market “all Quicken/QuickBooks stock” unless each named geometry has been measured and tested. Personal/wallet cheques are not required for the launch promise.

### 4. Calibration that solves the dominant complaint

- Start with a printable Letter-size calibration sheet with inch and millimetre rulers and crosshairs.
- Tell the customer to print the sample on plain paper, place it over the target stock and hold both to light.
- Keep production scale at 100%. Correct alignment with coordinates, not by squeezing the entire cheque.
- Support global X/Y offset in 1-point increments, with optional 0.5-point fine steps.
- Add bounded per-field X/Y adjustments for check number, date, payee, numeric amount, amount words and memo.
- Add separate bounded stub-field alignment for each voucher section.
- Provide Reset, Undo, duplicate profile and printer/stock-specific profile names.
- Continuously reject collisions with the MICR band, Canadian convenience-amount clear zone, page bounds and other protected areas.
- Display values in the customer’s preferred unit while storing exact points.
- Samples and calibration pages never count against the free live-print allowance.

### 5. Fast cheque creation

- Default to today’s local calendar date, the selected account and the next verified physical number.
- Search saved payees as the user types; reuse the payee’s address and default memo.
- Validate font support and field fit before the cheque can enter Ready status.
- Show a compact, exact preview with warnings beside the affected field.
- Add Duplicate previous and Save as payment template/favourite for recurring rent and vendors.
- Allow several Ready cheques to be selected and printed in one plan when they use the same account, currency, stock and calibration.
- Keep category optional. Do not force accounting terminology into the first-print path.

### 6. Safe print and misprint flow

After every live job, require exactly one outcome:

1. **Printed correctly** — confirm the immutable plan and add it to the register.
2. **Printed, but something is wrong** — mark the physical number as spoiled and offer a replacement using the next number.
3. **Nothing printed** — return the draft to Ready without consuming a cheque or free-use credit only when the host supplies trusted no-delivery evidence; otherwise use the possibly-printed/spoiled path.

The UI must explain that a replacement uses a new physical cheque number. A negotiable cheque is never silently reprinted with the same number. A register/voucher copy may be reprinted only when clearly labelled as a copy and excluded from cheque stock.

### 7. Automatic register and reconciliation

- Automatically show confirmed, outstanding, cleared, voided, spoiled and deleted-draft states.
- Search, sort and filter by account, number, issue date, payee, amount, status and category.
- Mark a printed cheque cleared/not cleared with a local calendar date.
- Preserve immutable printed snapshots even if the payee or account is later edited.
- Export filtered or complete registers as UTF-8-BOM CSV with account and currency columns.
- Add a print/PDF register report suitable for an accountant or paper file.
- Show totals for outstanding, cleared, voided and spoiled cheques without calling the result a bank balance.

Do **not** display a “current balance” unless the product later models opening balances, deposits, fees and other non-cheque transactions. A cheque-only balance would be misleading.

### 8. Data safety, recovery and privacy

- Enforce a single running writer or an equivalent revision-safe host lock.
- Await every state save and verify atomic recovery before reporting success.
- Protect the live encryption key with Windows facilities; use a separate user-controlled secret/recovery method for portable backups.
- Verify every backup after creation and every restore before replacement.
- Preserve a check-number and free-use high-water mark both beside the file and in a separate local application-data directory; if the authoritative copy is missing, require physical number confirmation.
- Store the live data file outside OneDrive, Dropbox and other synchronized folders. Use those services only as user-chosen backup destinations.
- Use heartbeat locks with machine and process-start identity, and expose a deliberate confirmed break-lock action for abandoned sessions.
- After restore, force confirmation of the next physical stock number before another live cheque can be queued.
- Provide account/payee edit and archive, never destructive removal of historical printed snapshots.
- Keep the product local-only: no login, cloud database, ads or telemetry.

### 9. Microsoft Store entitlement

- Free install.
- Unlimited watermarked, non-negotiable samples and calibration pages.
- Approximately three real cheques before Lifetime unlock, as already designed.
- Show the exact local Lifetime price before a live use is consumed.
- Restore purchase after reinstall and support reasonable offline receipt grace.
- Never let an entitlement refresh block confirmation of a job that was already sent to paper.
- Use “one-time purchase” plainly; avoid subscription-like or trial-renewal language.

### 10. US/Canadian language and standards behavior

- Ship `en-US`, `en-CA` and `fr-CA` as complete paths, including errors, onboarding, CSV headings/statuses and amount words.
- Use “check” in US English and “cheque” in Canadian English; use appropriate French Canadian terminology.
- Keep Canadian automated fields at least 10 pt where required by the layout rules.
- Constrain Canadian dates to the allowed non-slash format; the current engine correctly requires `YYYY-MM-DD` for Canadian profiles.
- Preserve the Canadian MICR band and the clear space around the convenience amount.
- For Canadian USD cheques, print the required US-funds designation without invading protected space.
- Preserve stock-supplied date indicators and cheque furniture rather than printing duplicates.
- Do not claim ANSI, Payments Canada, bank or printer certification without the corresponding licensed-standard review and physical qualification.

Primary standards references: [Payments Canada Standard 006](https://www.payments.ca/sites/default/files/standard006eng.pdf), [Payments Canada Cheque Printer Guide](https://www.payments.ca/payment-resources/support-guides/cheque-printer-guide), [Federal Reserve Check 21 FAQ](https://www.federalreserve.gov/paymentsystems/regcc-faq-check21.htm), [ANSI X9.100-110](https://webstore.ansi.org/standards/ascx9/ansix91001102021), and [ANSI X9.100-160](https://webstore.ansi.org/standards/ascx9/ansix91001602021).

### 11. Accessibility and support

- Full keyboard navigation, visible focus, screen-reader labels and logical tab order.
- High contrast, Windows text scaling and 200% zoom without clipped controls.
- Never rely on colour alone for status.
- Field-specific errors with an immediate correction, not a generic “invalid” dialog.
- Built-in first-run checklist and a one-page printable guide.
- “Copy diagnostics” that includes app version, printer/profile identifiers and geometry but excludes payee, amount, bank and address data.
- A clear support link and an in-app way to export an encrypted backup before troubleshooting.

### 12. Release evidence

Before Store submission, pass all of these gates:

- Golden PDFs for every country × currency × locale × layout × start-slot combination.
- Windows Print to PDF comparison at 100%, including ruler measurements of all field anchors.
- Physical overlay tests on every named stock profile.
- At least one representative laser and inkjet path before making broad printer claims.
- Long-payee, maximum-amount, accented-French, address, memo and font-boundary cases.
- Purchase, cancellation, offline grace and reinstall/restore scenarios using Microsoft Store sandbox accounts.
- Crash tests before queueing, after durable queueing, during dialog display and after paper may have been marked.
- Backup tamper, wrong-secret, newer-temp-file, stale-revision and concurrent-launch tests.
- Keyboard, screen reader, high contrast and 200% text review.
- Canadian pre-production samples submitted to the customer’s financial institution when required by the institution; WorksBien should recommend this, not represent the institution’s approval.

## Important improvements after launch (P1)

These help compete but should not delay the dependable core:

- encrypted signature image protected by Windows Hello/PIN, with an explicit risk warning;
- payee mailing address on compatible voucher/window-envelope stubs;
- richer PDF reports and scheduled backup reminders;
- manual recurring templates with a due-date reminder, not unattended cheque creation;
- optional user-chosen OneDrive/Dropbox folder as a normal file-backup destination, without a WorksBien cloud account;
- additional physically measured stock profiles;
- optional local app lock and automatic inactivity lock;
- payee/category analytics that never pretend to be accounting software.

## Features to exclude from this launch

These are not needed to make the current product complete and would weaken its reliability promise:

- blank-stock cheque design and MICR printing;
- deposit slips;
- bank login, bank feeds or automatic account reconciliation;
- payroll, tax and bookkeeping;
- arbitrary drag-anything template design;
- cloud account/sync, multi-user collaboration and remote printing;
- ads or a subscription;
- personal/wallet cheque formats unless the product positioning is deliberately expanded.

Blank-stock/MICR support should be treated as a separate future product tier. The moment WorksBien prints routing/account MICR data, logo/furniture and signature-ready blank cheques, printer qualification, magnetic ink, security, standards licensing and support obligations change materially.

## Gap against the current engine

| Area | Current state | Required change |
|---|---|---|
| Money, numbering, lifecycle and audit | Strong and tested | Preserve as locked domain behavior |
| PDF geometry | Deterministic US Letter plans; 100% scale and bounded field/stub offsets implemented | Complete Windows/physical-stock acceptance and customer calibration UI |
| Layouts | Voucher-top, voucher-middle, voucher-bottom and three-up; three-up start slot is explicit | Physically qualify every advertised stock SKU and surface the remaining-slot workflow in the host |
| Dates | US options; Canada constrained to `YYYY-MM-DD` | Preserve; localize surrounding guidance and indicators |
| Localization | `en-US`, `en-CA`, and `fr-CA` catalogs, frozen cheque locale, French amount words and numeric amounts | Complete native-language host copy and perceptual QA |
| Register | Automatic state model, clearing, reconciliation, deterministic filtering/sorting, matching CSV and structured report | Build the customer-facing report UI/PDF skin; never label totals as account balance |
| Repeated payments | Local payment favourites and Duplicate previous create newly numbered drafts | Surface the minimum-tap host workflow; unattended scheduling remains excluded |
| Payees/accounts | Stored, editable/archiveable in engine | Surface editing; use address on compatible stubs where appropriate |
| Calibration | 100% production scale; global X/Y plus safe per-field and per-stub half-point nudges | Add host Reset, Undo, duplicate-profile and unit-display workflows |
| Windows printing | Portable renderer, exact Letter/100%/no-fit job contract, and unified three-outcome engine API | Build and verify the native Windows adapter, printer enumeration and dialog integration |
| Purchase | Entitlement model exists | Implement Store purchase, restore, cancellation and offline handling |
| Persistence | Encrypted state, backup/restore and concurrency protections exist | Bind to Windows secret protection and prove host-level single instance/durable writes |
| Usability/accessibility | Not represented by backend | Build, test and document the complete first-run and print workflows |
| Physical acceptance | PDF/software checks passed | Ruler, stock, printer and financial-institution acceptance remains external |

## Definition of done

The product is ready to call complete when:

- every P0 requirement is implemented;
- no open severity-1 or severity-2 defect exists in create → calibrate → queue → PDF/print → confirm → register → backup/restore;
- a first-time tester completes a sample without assistance and a live-stock tester completes a correctly aligned cheque after one calibration pass;
- the app passes the full US and Canadian golden/physical matrix;
- Store purchase restoration succeeds after uninstall/reinstall;
- the published listing accurately says **preprinted business stock**, **local-only**, **one-time purchase**, **USD/CAD**, and names only tested layouts/devices;
- unsupported features are explicitly absent rather than simulated or ambiguously marketed.

## Final product decision

Do not add company letterhead, bank details, routing numbers or a logo to the production cheque layer for this launch. The target preprinted stock already supplies those static and bank-controlled elements. WorksBien’s job is to place the variable payment data precisely, produce useful voucher records, and maintain an honest local register. That narrower promise is fully competitive if calibration, recovery and purchase restoration are better than the incumbents.
