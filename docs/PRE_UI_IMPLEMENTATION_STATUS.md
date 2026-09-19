# Pre-UI implementation status

**Product:** Check Printer & Check Writer  
**Publisher:** WorksBien Studios Inc.  
**Scope:** The 23 items approved for completion before UI work  
**Status date:** 2026-09-19

## Outcome

The pre-UI application layer is implemented without changing the approved
cheque engine or PDF renderer. The Windows host, secure local persistence,
printing/PDF adapters, entitlement rules, Store bridge, localization contracts,
legal source text, MSIX configuration, tests, and Windows build pipeline are in
place.

Items 13 and 14 contain complete fail-closed code and packaging contracts, but
the corresponding Partner Center records cannot be created in source code. The
reserved product identity and durable add-on must be created in the publisher's
Partner Center account, after which their exact identifiers are supplied to the
existing release configuration. Partner Center was not reachable from the
current environment, so those external records are not represented as complete.

No visual UI was built in this phase. The present application entry point is a
headless single-instance/composition smoke host.

## 1–23 evidence ledger

| # | Deliverable | Status | Implementation evidence |
|---:|---|---|---|
| 1 | Windows technology and project structure | Implemented | Electron 44 + TypeScript Windows host under `windows-host/`, with separate application, platform, product, packaging, localization and test layers. |
| 2 | Secure Windows key storage | Implemented | `secure-secret-store.ts` protects the data key with Electron `safeStorage` (Windows DPAPI) and creates it under the cross-process state lease. |
| 3 | Local database/file persistence | Implemented | `state-repository.ts` wraps the approved encrypted engine store with atomic writes, revisions, crash recovery, rollback guard checks and serialized session operations. |
| 4 | Backup and restore | Implemented | The host exposes the approved passphrase-encrypted, verified backup/restore path and retains numbering safety checks. |
| 5 | Printer detection and selection | Implemented | Electron printer enumeration, stable printer selection, capability reporting and explicit confirmation when Letter support cannot be proven. |
| 6 | Save PDF | Implemented | Exact approved PDF bytes are written atomically to the user-selected path and re-read/hashed for verification. |
| 7 | Native Windows printing | Implemented | Silent native submission uses Letter, 100% scale and no fit/shrink; bytes are re-hashed immediately before submission and ambiguous outcomes remain unresolved rather than being marked printed. |
| 8 | Single instance | Implemented | Electron OS lock plus leased data-file lock with heartbeat, process-start identity, machine identity and deliberate stale-lock recovery. |
| 9 | Three-free entitlement | Implemented | Exactly three distinct live cheques are allowed; samples and calibration do not count; valid spoiled-cheque replacements preserve the allowance contract. |
| 10 | Lifetime validation | Implemented | Serialized entitlement coordinator validates a fresh active Microsoft Store licence through the native bridge and protects the cached receipt metadata. |
| 11 | Purchase restore | Implemented | Explicit restore operation refreshes the active Store licence and never replaces Microsoft account/Store ownership checks with a local flag. |
| 12 | Offline purchase behaviour | Implemented | No offline purchase is claimed. Previously verified Lifetime access receives a protected maximum 30-day grace period only when the Store service is unavailable, with clock-rollback protection. |
| 13 | Reserve Store name/package identity | **External Partner Center action pending** | Public name is locked as **Check Printer & Check Writer**. Release manifest generation refuses placeholder identity values. Exact Partner Center identity name, publisher and Store application ID remain external inputs. |
| 14 | Lifetime add-on and price | **External Partner Center action pending** | Durable logical product `lifetime_unlock`, purchase/restore/licence code and localized-price validation are implemented. Create the non-expiring add-on in Partner Center, target USD 19.99 / CAD 25.99, and use the resulting Store ID; runtime always displays `StoreProduct.Price.FormattedPrice`. |
| 15 | Navigation and screen flow | Contract complete | `navigation.ts` plus `PRE_UI_SCREEN_FLOW.md` define the state-driven route map without creating UI. |
| 16 | Loading/empty/warning/error/success states | Contract complete | `customer-states.ts` and `PRE_UI_CUSTOMER_STATE_MODEL.md` define deterministic customer-visible states, actions and recovery paths. |
| 17 | Final customer copy | Complete for pre-UI integration | Locale catalogs contain field-specific product, print, entitlement, backup and recovery copy; no UI component owns hard-coded customer text. |
| 18 | en-US, en-CA and fr-CA | Implemented | Complete `en-US.json`, Canadian overrides, `fr-CA.json`, locale manifest validation, fallback policy and matching MSIX resource declarations. |
| 19 | es-US decision | Locked | Deferred from launch and documented in `PRE_UI_LOCALIZATION_DECISION.md`; no partial Spanish surface will ship. |
| 20 | Privacy, terms and purchase disclosures | Draft pack complete | Controlled English/Canadian-French source files and the rendered policy pack in `docs/privacy/`; professional legal review and final public URLs remain release gates. |
| 21 | Adapter tests | Implemented | Strictly typechecked Windows-host adapter, product and composition tests, plus the unchanged engine/PDF test suites. |
| 22 | MSIX configuration | Implemented | x64/ARM64 custom manifest generation, three languages, `runFullTrust`, no `internetClient`, packaged Store bridge and release-time refusal of development identities. Final branded tiles/icons belong to the later UI/brand phase. |
| 23 | Automated build pipeline | Implemented | Windows Server 2025 CI installs Node 24/.NET 8, verifies TypeScript/tests, compiles the bridge, builds both MSIX architectures, unpacks and asserts the actual manifests/payloads, smoke-runs x64 and uploads artifacts. |

## Verified locally

- Windows host: strict source/test typecheck, **41/41 tests**, and TypeScript build pass.
- Approved engine: **81/81 tests** pass.
- Engine coverage: 98.61% lines, 86.13% branches and 95.53% functions.
- PDF integrity: **47 PDFs** pass structural/integrity checks.
- Golden rendering: **5 PDFs** pass 300-DPI image comparisons.
- Production dependency audit: zero known vulnerabilities (`npm audit --omit=dev`).
- Policy pack: all 10 rendered pages visually inspected; no clipping, blank pages or broken tables.

## Remaining external and Windows release gates

These are validation/deployment gates, not unfinished UI work:

1. Reserve/confirm the product in Partner Center and copy its exact identity,
   publisher and application Store ID into the release environment.
2. Create the non-expiring Lifetime add-on, set US/Canada market prices, and
   copy its Store ID into the bridge environment.
3. Run the committed Windows CI workflow and retain the two inspected unsigned
   MSIX artifacts.
4. Associate a signed package flight with the Store product and test price,
   purchase, restore, refund/revocation and offline-grace behaviour with Store
   test accounts. `Windows.Services.Store` has no equivalent local simulator.
5. On Windows, validate Microsoft Print to PDF and at least one real printer;
   when the driver does not declare Letter capability, confirm that the manual
   Letter acknowledgement gate appears.
6. Before public submission, add final branded MSIX assets, obtain professional
   legal review, and publish the final privacy/terms URLs.

## Locked boundaries

- No bank connection, online banking credentials, cloud sync, telemetry, ads or
  blank-stock MICR printing.
- Preprinted compatible cheque stock only.
- Free install; exactly three distinct live cheques; unlimited watermarked
  samples and calibration sheets.
- One-time, non-expiring Lifetime add-on; no subscription.
- The approved engine and PDF renderer remain the source of truth.
- No front-end implementation is included in this checkpoint.
