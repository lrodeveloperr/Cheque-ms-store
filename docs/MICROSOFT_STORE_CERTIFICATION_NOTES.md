# Microsoft Store certification notes

## `runFullTrust` restricted capability

Use the following text in Partner Center when asked why the package requires
`runFullTrust`:

> Check Printer & Check Writer is a packaged Win32 desktop application built
> with Electron and distributed as an MSIX package. Its executable is declared
> as a Windows Full Trust Application, so the `runFullTrust` capability is
> required for Windows to launch and operate the desktop application outside
> the AppContainer.
>
> The capability is used only for the app’s core, user-initiated desktop
> functions: enumerating installed Windows printers and submitting
> user-confirmed print jobs through the native Windows print path; generating
> and saving cheque PDFs, CSV exports and encrypted backup
> files; restoring a user-selected encrypted backup; storing encrypted cheque
> records locally using Windows-protected storage; and communicating with the
> packaged Microsoft Store licensing component to purchase, restore and
> validate the optional non-expiring Lifetime Unlock.
>
> The application runs with the signed-in user’s standard permissions. It does
> not request administrator elevation, install drivers or services, modify
> Windows settings, access other applications’ data, or register or run
> persistent background tasks or startup processes. It does not connect to
> financial institutions, move money or transmit cheque records to WorksBien.
> Printing, exports, backups, restores
> and purchases are initiated by the user.

## Reviewer facts

- No sign-in or test credentials are required.
- The app is a local-first business cheque overprinter and register.
- Compatible preprinted business cheque stock is required for live output.
- The app does not print MICR bank identity, routing or account lines.
- The app does not connect to a bank, move money, verify funds or calculate a
  bank balance.
- The app does not declare `internetClient`; cheque records are not transmitted
  to WorksBien.
- The first three distinct live cheques are free. Non-negotiable samples and
  calibration sheets are unlimited and do not count.
- Lifetime Unlock is a single non-expiring Microsoft Store durable add-on. It
  is not a subscription and does not renew.
- The app does not request administrator elevation and does not install a
  Windows service or driver.

## Localized product names

| Locale | Store and in-app product name |
|---|---|
| `en-US` | Check Printer & Check Writer |
| `en-CA` | Check Printer & Check Writer |
| `fr-CA` | Impression et rédaction de chèques |

The French name must be reserved and selected for the `fr-CA` Store listing in
Partner Center before submission. The current package manifest display name
remains English; manifest resource localization requires a separately validated
`.resw`/PRI packaging change and is not part of this source-only update.
