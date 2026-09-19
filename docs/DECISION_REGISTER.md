# Decision register

| Decision | Outcome | Why | Revisit trigger |
|---|---|---|---|
| Product position | `Business Check Printer & Register` | Matches direct search intent and validated paid demand | Naming research before listing lock |
| Stock | Preprinted only | Removes MICR, toner, bank-acceptance, and fraud complexity | Verified demand for blank stock plus standards/legal review |
| Layouts | Voucher-top, voucher-middle, voucher-bottom, and three-up, US Letter | Covers the launch business-stock positions with immutable geometry and preserved three-up start slots | Add a stock only after measurement and physical qualification |
| Currency/locale | USD/CAD with en-US, en-CA, and fr-CA | Quebec coverage is a competitive gap; the printed language is frozen per cheque | Add a language only after native terminology and print-fit QA |
| Storage | AES-256-GCM local state plus sibling and separate-app-data encrypted high-water guards | Survives ordinary data-folder rollback; a missing authoritative guard forces number confirmation | Windows Credential Manager key adapter design |
| Portable restore | Require next-stock-number confirmation; exhaust Free conservatively | A backup cannot prove what printed after it was made or on another device | A trusted cross-device monotonic service is explicitly added |
| Check number after deleted draft | Remains reserved | Safer than reuse; preserves a clean audit story | Never automatically revisit |
| Successful print | Explicit host/user confirmation | An OS submission does not prove paper output | Physical printer adapter proves a stronger signal |
| Replacement | Spoiled original is voided; replacement gets a new number and reciprocal link | Preprinted stock carries a different physical number | Never reuse the original number |
| Free tier | Reserve capacity before plan creation; consume on confirmation/unknown; refund `NOT_SENT` only with trusted host evidence; replacements do not double-charge | Lets a buyer prove the workflow without creating a duplicate-output or restore loophole | Conversion/support data after launch |
| Historical names | Snapshot account/payee display data into every check | Later master edits must not rewrite ready/printed history | Never for existing records |
| Calibration lifecycle | Profile becomes immutable after first attempt | Attempt evidence must retain exact printer/stock/calibration identity | Add explicit versioning only if UI demand warrants it |
| Calibration geometry | Production scale fixed at 100%; bounded global, per-field, and per-stub point offsets | Correct printer registration without squeezing fields or entering protected zones | A physically measured stock requires a different immutable template |
| CSV export | Spreadsheet-safe CSV, not XLSX | No dependency, transparent format, opens in Excel | Strong user demand for styled XLSX |
| Repeated payments | Manual favourites and Duplicate previous at launch; unattended scheduling excluded | Meets repeated-vendor/rent demand without background approval risk | Verified demand for reminders or schedules |
| Register scope | Cheque register and cheque-status totals, never a bank balance | Deposits, fees, and non-cheque transactions are absent, so a balance would mislead | Product explicitly expands into a full ledger |
| UI | Browser acceptance site only | Keep production visual work separate while the 0.4.0-rc.1 engine receives external verification | User explicitly starts production UI work |
