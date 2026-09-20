# Pre-UI product, commerce and localization lock

**Candidate:** Windows host product layer 0.1  
**Date:** 2026-09-19  
**Scope:** pre-UI items 9–20  
**Status:** software-complete; Partner Center and packaged-Windows verification remain external

## Completion map

| Item | Locked result | Evidence |
|---|---|---|
| 9. Three-free-cheque entitlement | The engine remains authoritative for exactly three distinct live cheques. Samples and calibration are unlimited. Replacements do not consume another free use. The host mirrors the boundary and cannot start a free live job until it has shown a Store-formatted Lifetime price. | `print-access.ts`, entitlement tests |
| 10. Lifetime validation | Only a matching, active Microsoft Store license for the configured non-expiring Durable add-on grants Lifetime. A purchase-dialog success is not enough; the host refreshes the license after purchase. | `entitlement.ts`, `store-bridge/Program.cs` |
| 11. Purchase restoration | Restore queries the signed-in Store account. Active means restored; a successful query with no active matching add-on means not owned. A transient error never becomes ownership. | restore tests |
| 12. Offline purchase behaviour | A previously Store-verified purchase receives 30 days of protected offline grace. Clock rollback, invalid identity or an invalid Store response fails closed. After grace, records, exports, backups and pending print outcomes remain available; only new live jobs wait for revalidation. | offline and rollback tests |
| 13. Store name and package identity | Store title and package display name are **Check Printer & Check Writer**. Publisher is **WorksBien Studios Inc.** The scaffold name `WorksBienStudios.CheckPrinterCheckWriter` is rejected in production until Partner Center supplies authoritative package values. | `product-identity.ts` |
| 14. Lifetime add-on and pricing | Logical Partner Center product ID is `lifetime_unlock`; type is Durable; duration never expires. Launch catalog targets are US$19.99 and CA$25.99. The runtime UI displays only `StoreProduct.Price.FormattedPrice`. The generated add-on Store ID is mandatory and never guessed. | identity and Store bridge tests |
| 15. Navigation and screen flow | Calm five-destination shell: Home, Cheques, Register, Payees and Settings. First-run, real-print, Save PDF and restore paths are explicit and guarded. | `navigation.ts`, `PRE_UI_SCREEN_FLOW.md` |
| 16. Loading/empty/warning/error/success states | Startup, Home, account, printer, calibration, payee, cheque, PDF, print, register, backup, restore, purchase and license each have all six state classes with feature-specific recovery copy. | `customer-states.ts`, localization tests |
| 17. Customer-facing copy | Onboarding, preprinted-stock limits, exact-output warnings, print outcomes, number recovery, Store purchase, backups, errors, diagnostics and register limitations are frozen before UI work. | resolved localization catalogs |
| 18. Host localization | Complete resolved key parity for `en-US`, `en-CA` and `fr-CA`. Canadian English uses “cheque”; Quebec French uses native operational terminology. Placeholder parity is enforced. | `localization/*`, `catalog-loader.ts` |
| 19. `es-US` decision | **Deferred, not launch.** See `PRE_UI_LOCALIZATION_DECISION.md`. | decision record |
| 20. Privacy, terms and purchase disclosures | Code-grounded English and Canadian French source text covers local-only data, Windows-protected encryption, user backups, Store processing, no bank connection, preprinted-stock scope, bank acceptance, refunds and the exact free/Lifetime boundary. | `docs/privacy/*` |

## Commerce invariants

1. The host uses `Windows.Services.Store.StoreContext` only from the packaged native bridge.
2. Store calls fail closed when package identity is absent or invalid. Purchase also requires StoreContext to be initialized with the owning HWND.
3. The bridge accepts only the Partner Center add-on Store ID provided in `WORKSBIEN_LIFETIME_STORE_ID` and refuses any other ID.
4. The logical offer token must be exactly `lifetime_unlock`; the product kind must normalize to `DURABLE`.
5. The displayed price comes verbatim from `StoreProduct.Price.FormattedPrice`. Catalog targets are submission configuration, never runtime price copy.
6. Purchase completion is followed by a fresh license query. Only its matching active license grants Lifetime.
7. Existing Lifetime access is independent of later catalog price changes.
8. A pending physical-print outcome is always resolvable, even when license verification changes.
9. Fresh offline installs cannot restore a purchase. The user must connect to Microsoft Store once.
10. Offline receipt and price caches must be stored with Windows-protected integrity; neither is a portable proof of purchase.

Microsoft documents non-expiring Durable add-ons, `StoreContext`, add-on licenses, Store IDs and the desktop HWND requirement in [In-app purchases and trials](https://learn.microsoft.com/en-us/windows/uwp/monetize/in-app-purchases-and-trials). Store policy requires accurate purchase disclosure, localization of advertised languages and a privacy policy for Win32/Desktop Bridge products: [Microsoft Store Policies](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies).

## External actions that code cannot complete

1. Publish an unavailable/private package flight, install it from Store, and run purchase, cancel, offline, account-switch, reinstall and restore tests. `Windows.Services.Store` has no local simulator for this path.
2. Host the final privacy-policy URLs and enter them in Partner Center for every declared localization.
3. Complete age rating, purchase-range disclosure and reviewer instructions in Partner Center.

The product reservation, production package identity, non-expiring Durable
`lifetime_unlock` add-on, generated Store IDs and US/Canada catalog targets are
complete and encoded in the release configuration.

## Verification commands

```bash
node --test windows-host/test/product/*.test.ts
npx tsc --noEmit --target ES2024 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --types node --allowImportingTsExtensions --verbatimModuleSyntax windows-host/src/product/*.ts windows-host/test/product/*.ts
```

The C# bridge must additionally compile on Windows CI:

```powershell
dotnet build -c Release windows-host/src/product/store-bridge/WorksBien.StoreBridge.csproj
```
