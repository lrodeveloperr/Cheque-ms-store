# Locked functional screen flow

This is information architecture, not visual design. The UI must call the locked engine and product layer rather than reproduce their rules.

## Primary shell

| Destination | Customer job |
|---|---|
| Home | One-stop summary: selected account, next physical number, printer/stock readiness, free/Lifetime state, unresolved print outcomes, and New cheque |
| Cheques | Draft, Ready and recent cheque work; create, duplicate, correct or resolve |
| Register | Search, filter, clear, export and review cheque-only totals |
| Payees | Add, edit, archive and reuse local payees |
| Settings | Accounts, stock, calibration, backup/restore, language, purchase, privacy and help |

Help remains reachable from onboarding, errors and Settings but is not a sixth primary destination.

## First launch

1. Welcome: local-only, no bank connection, preprinted stock.
2. Stock check: confirm the paper already has bank identity and MICR data.
3. Account: jurisdiction, currency, local label, payor and next physical number.
4. Layout: voucher top/middle/bottom or three-up and the first unused position.
5. Printer: a Windows printer or Microsoft Print to PDF for testing.
6. Calibration: free ruler PDF on plain Letter paper at 100% / Actual size.
7. Home: setup status and a single New cheque action.

The customer can leave and resume onboarding without losing valid completed steps. No WorksBien account, purchase decision or bank credentials interrupt first-run setup.

## Real cheque

`Home → New cheque → Review exact output → Save PDF or Print → Confirm physical outcome → Completion → Register`

- Review must surface field fit, physical number, stock slot, printer/profile identity and the Store price/free-use disclosure before queueing.
- Queueing is durably saved before PDF bytes or a printer dialog become available.
- Save PDF and native print receive the same immutable PDF bytes.
- A native print always ends in one of: printed correctly; paper marked/problem; nothing printed with trusted host evidence.
- Closing during the outcome step returns to the unresolved outcome on next launch.

## Sample and calibration

Both are unlimited, watermarked/non-negotiable where applicable, and never reserve or consume a real cheque number. They may be saved or sent to Microsoft Print to PDF without opening the purchase flow.

## Purchase and restore

`Settings → Lifetime Unlock → Store-formatted price → Microsoft confirmation → License refresh → Success`

`Settings → Lifetime Unlock → Restore purchase → License refresh → Restored / Not found / Connection required`

Purchase and restore are unavailable without the Store-associated package. The host may explain the requirement but must not provide an alternate web checkout.

## Data restore

`Settings → Backup and restore → Select encrypted backup → Verify → Safety copy → Restore → Confirm each next physical number → Home`

Portable restore conservatively exhausts the free allowance because the backup cannot prove later output. It does not grant or remove Store ownership; Restore purchase is a separate Microsoft operation.
