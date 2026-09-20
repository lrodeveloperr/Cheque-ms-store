# Operations Desk design QA

## Scope

- UI direction: Operations Desk
- Viewport: 1200 × 750 CSS pixels at 1× density
- Reference: `/workspace/scratch/89520e956def/operations-desk-source-normalized.png`
- Browser-rendered deployment: `/workspace/scratch/89520e956def/operations-desk-version-v4.png`
- Side-by-side comparison: `/workspace/scratch/89520e956def/operations-desk-comparison-v4.png`
- Deployment: private Sites version 4, source commit `dd183377edbeeaf62c434d6f49e11d3a22a99325`

## Pass history

### Pass 1

| Severity | Finding | Resolution |
| --- | --- | --- |
| P2 | The metric row showed Active account instead of the selected Stock layout. | Restored the four operational metrics: next physical number, printer, stock layout, and free checks remaining. |
| P2 | The top bar and workspace repeated “Operations desk.” | Changed the top-bar context to “Payment operations” while retaining “Operations desk” as the page heading. |
| P2 | The browser build copied unused icon weights and SVG sources. | Limited packaged icon assets to the two font files referenced by the stylesheet. |

### Pass 2

| Check | Result | Evidence |
| --- | --- | --- |
| Operations hierarchy | Pass | Top bar, four operational metrics, recent activity and readiness are visible without scrolling. |
| Alignment and rhythm | Pass | Cards share consistent baselines, gutters and border treatment at the target viewport. |
| Responsive contract | Pass | Desktop, compact and 200% text/reflow rules are present and covered by UI tests. |
| Accessibility structure | Pass | Navigation, main content, status surfaces and footer use named landmarks; keyboard/focus helpers are covered by tests. |
| Localization | Pass | en-US, en-CA and fr-CA catalogs have key and placeholder parity; formatting uses locale-aware APIs. |
| Interaction logic | Pass | Route changes, guarded flows, onboarding, cheque review/output, print outcomes, register and settings are covered by the 66-test Windows-host suite. |
| Runtime errors | Pass | Version 4 rendered successfully through the Sites browser renderer; deployment completed successfully and the test suite reports no failures. |

## Final result

Passed. No P0, P1 or unresolved P2 issues remain in the Operations Desk implementation. The approved PDF renderer and cheque engine were not changed during this UI work.
