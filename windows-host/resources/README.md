# Check Printer & Check Writer package resources

`app-icon.svg` is the source of truth for the Windows executable and MSIX tile
artwork. `app-icon.ico` and the PNG files in `msix-assets/` are generated from
that master and committed so Windows packaging does not depend on an image
toolchain being present on the build runner.

The in-app mark is a deliberately simplified derivative in
`src/ui/assets/brand-mark.svg`; it remains legible in the 38 px sidebar slot.
