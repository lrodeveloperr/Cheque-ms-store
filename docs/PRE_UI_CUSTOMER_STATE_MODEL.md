# Customer-state model

Every major host feature has explicit `IDLE`, `LOADING`, `EMPTY`, `WARNING`, `ERROR` and `SUCCESS` states in `windows-host/src/product/customer-states.ts`.

The covered features are startup, Home, account, printer, calibration, payee, cheque, PDF, print, register, backup, restore, purchase and license. Each state maps to localized title/body/action keys. Warning and error bodies identify the actual condition and recovery: for example, a printer mismatch says to choose the calibrated profile; a PDF failure says to choose a writable destination; a restore failure promises that current data was not replaced; and a purchase failure says Lifetime was not granted without an active Store license.

Rules:

- Loading states block the affected action and never imply completion.
- Empty states give a valid next action rather than presenting an error.
- Warnings block a consequential operation only when review or confirmation is required.
- Errors preserve prior data and name the smallest safe recovery.
- Success appears only after the durable write, backup verification, final license query or other authoritative completion point.
- Print submission is never called success. Only the recorded whole-document outcome is success.
- Closing a pending print outcome does not discard it.
- Store and storage diagnostics use machine codes internally; users see localized actionable copy.

Automated tests require all six states for every feature and require every referenced message/action key in all three resolved launch catalogs.
