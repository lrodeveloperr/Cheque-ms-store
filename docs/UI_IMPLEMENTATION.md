# Operations Desk UI implementation

## Locked direction

The customer-facing Windows interface uses the **Operations Desk** direction. It is a calm, compact operations workspace intended for repeat cheque preparation, printing and reconciliation. The earlier Focus Workspace direction is not part of the product.

## Implemented surfaces

- First-run setup for jurisdiction, currency, account, preprinted stock, printer and calibration.
- Home operations dashboard with the next physical number, printer, stock layout and free-use allowance.
- Cheque creation, exact-PDF review, safe output selection and the three physical print outcomes.
- Pending-print recovery before additional live output.
- Register search, filters, totals and CSV import/export intents.
- Payee maintenance.
- Account, stock, printer, calibration, backup/restore, language, Lifetime Unlock, privacy and help settings.
- en-US, en-CA and fr-CA catalog-driven copy and locale-aware date, number and currency formatting.
- Keyboard navigation, focus recovery, named landmarks, high-contrast support, reduced-motion support and 200% text reflow.

## Desktop integration

The renderer runs with context isolation, sandboxing and a narrow preload bridge. The main process owns encrypted persistence, Store commerce, native file dialogs, exact-PDF saving, native printing, print-outcome confirmation, backup and restore. UI code cannot access Node.js or the filesystem directly.

## Deliberately deferred to Store submission

- Final Microsoft Store package identity values.
- Final Partner Center add-on identifier for Lifetime Unlock.
- Store-generated localized price strings and license verification against the production listing.

These are Partner Center inputs, not unfinished UI or cheque-engine work.

## Verification

- Windows host: 66 tests, clean typecheck and successful production build.
- Cheque engine: 81 tests, clean typecheck, valid runtime gates and coverage thresholds met.
- Production dependency audit: zero known vulnerabilities.
- Locked engine, PDF geometry, tests and root localization catalogs are unchanged from the `ui-baseline` tag.
