# Microsoft Store packaging inputs

Public English product name: **Check Printer & Check Writer**. The Canadian
French Store and in-app name is **Impression et rédaction de chèques**.
Package-safe executable stem: `CheckPrinterCheckWriter`.

The CI package is unsigned and uses a development identity by default. The
canonical production values from Partner Center live in
`src/product/partner-center.production.json`; they are public product metadata,
not signing secrets. For a Store-bound package, set `MS_STORE_RELEASE=1`.
Environment overrides are accepted only when they exactly match the canonical
configuration:

- `MS_STORE_IDENTITY_NAME`
- `MS_STORE_PUBLISHER`
- `MS_STORE_PUBLISHER_DISPLAY_NAME`

Run `npm run package:msix` on Windows 10/11 with the Windows SDK. Electron
Forge's MSIX maker produces native `.msix` packages for x64 and ARM64. The
build fails rather than silently creating a Store-release package with a
placeholder or mismatched identity. At runtime, a Windows Store-installed
package uses the same embedded configuration for app and Lifetime add-on
licence checks; unpackaged development builds remain Store-unassociated.

`Package.appxmanifest.template.xml` records the exact identity, language,
desktop target and full-trust shape expected from the generated manifest. The
Forge configuration generates the build manifest from the same values; compare
the packaged manifest to this template during Partner Center release QA.

The package contains a classic Electron/Win32 desktop executable with the
`Windows.FullTrustApplication` entry point, so its manifest intentionally
declares the restricted `runFullTrust` capability. The certification wording
and the precise limits on this capability are maintained in
`docs/MICROSOFT_STORE_CERTIFICATION_NOTES.md`.

The package starts the Electron BrowserWindow only after composing the platform,
persistence and product services and acquiring the single-instance lock.
