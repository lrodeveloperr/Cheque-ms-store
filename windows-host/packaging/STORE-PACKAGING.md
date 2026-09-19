# Microsoft Store packaging inputs

Public product name: **Check Printer & Check Writer**. Package-safe executable
stem: `CheckPrinterCheckWriter`.

The CI package is unsigned and uses a development identity by default. For a
Store-bound package, set `MS_STORE_RELEASE=1` and provide the exact values from
the Microsoft Partner Center product identity page:

- `MS_STORE_IDENTITY_NAME`
- `MS_STORE_PUBLISHER`
- `MS_STORE_PUBLISHER_DISPLAY_NAME`

Run `npm run package:msix` on Windows 10/11 with the Windows SDK. Electron
Forge's MSIX maker produces native `.msix` packages for x64 and ARM64. The
build fails rather than silently creating a Store-release package with a
placeholder identity.

`Package.appxmanifest.template.xml` records the exact identity, language,
desktop target and full-trust shape expected from the generated manifest. The
Forge configuration generates the build manifest from the same values; compare
the packaged manifest to this template during Partner Center release QA.

The current package entry point is intentionally headless: it proves
single-instance startup and composes the platform, persistence and product
services without opening a window. The later UI phase will add the BrowserWindow
and presentation layer while retaining this application composition boundary.
