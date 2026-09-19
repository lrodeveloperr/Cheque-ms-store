# Release gate

Current state: **0.5.0 PDF-INTEGRITY CANDIDATE — SOFTWARE TESTED, PHYSICAL VALIDATION OPEN**

Candidate: 0.5.0-rc.1  
Verified: 2026-09-19 on Node 24.19.0

## Gate results

| Gate | State | Evidence |
|---|---|---|
| Product contract | Pass | Package version and gate manifest identify candidate 0.5.0-rc.1; the existing product contract remains unchanged except for the locked renderer handoff |
| Stock-layout/calibration suite | Pass | `printing.test.ts`, `persistence.test.ts`: voucher top/middle/bottom, three-up start slots, local bounds/collisions, 100% scale, and schema migration |
| Full unit/integration suite | Pass | 81/81; 98.61% lines, 86.13% branches, 95.53% functions |
| Lifecycle stress | Pass | 10,000 deterministic state-machine sequences |
| CSV stress | Pass | 100,000 generated cases plus exact byte/row/column boundaries |
| Customer-risk evaluation | Pass after remediation | `CUSTOMER_EVALUATION.md`; exact restore/lock/snapshot/binding repros rechecked |
| Final independent reliability review | Pass | `CODE_BREAKER_REVIEW.md`; public-API probes, migration adversarial matrix, document-atomicity checks, and 6,751 extra fractional calibration profiles |
| Package/gate/harness | Pass | `npm run validate:gates` executes typecheck, coverage thresholds, PDF integrity, 300-DPI visual regression, and package-inventory rejection; `npm run harness -- demo` and `npm run scenarios` exercise the adapters |
| Shared PDF renderer | Pass | Browser and portable file adapter call `renderPdfArtifact`; live/preview modes share coordinates and embedded font metrics |
| PDF structural integrity | Pass | 47 current-version PDFs: exact page boxes, zero rotation, `/PrintScaling /None`, embedded font subsets/Unicode maps, no encryption/JavaScript/forms, sparse production output, and SHA-256 evidence |
| PDF visual regression | Pass | Five representative US/Canadian English/Canadian French live, sample, and calibration pages match approved 300-DPI golden PNGs with zero changed pixels |
| Independent US layout review | Partial | Prior approval covers the shared cheque-field geometry; new middle/bottom physical stock positions remain external |
| Independent Canadian layout review | Partial | Prior approval covers the shared cheque-field geometry; voucher orientation and new physical stock positions remain supplier/FI-qualified |
| User ruler/stock acceptance | Pending | Print at Actual Size and compare against the target stock/sample |
| Physical printer/stock claims | Not run | Required only before claiming named printer/stock compatibility |

## Backend acceptance

Candidate 0.5.0-rc.1 extends the previously reviewed cheque-field geometry to measured voucher-top, voucher-middle, voucher-bottom, and three-up Letter templates. It locks production output to 100%, verifies queued plan hashes, returns a final-PDF hash, embeds the approved font subsets, validates render fit before Ready, and adds bounded field/stub registration offsets with ruler-to-correction conversion. It is not connected to a bank or remote service. The stock positions are software-tested but are not claims of supplier, printer, or financial-institution qualification.

The hardening recheck adds schema 7, a rollback-resistant physical three-up sheet/slot ledger, host-evidenced no-output refunds, reversible unresolved-misprint classification, date-order validation, French-Canadian Excel CSV conventions, deterministic error keys with parameters, asynchronous state-store key derivation, redundant out-of-folder guards, and token-isolated heartbeat locks with confirmed recovery. The shipped evidence directory and npm inventory exclude encrypted test-state, backup, guard, lock, and heartbeat files.

The host must still prove that it:

- acquires the instance lock and awaits durable queueing;
- uses the shared renderer and preserves its exact PDF bytes without a second native re-layout;
- maps native print outcomes to the three engine outcomes;
- stores the live secret using Windows protection;
- prompts for number confirmation after a fresh restore;
- localizes message keys rather than developer diagnostics.

## External evidence before a store claim

- Keep the five approved 300-DPI golden images under review when an intentional layout change occurs.
- Verify at least one Windows PDF driver path at Actual Size.
- If marketing specific paper/printer compatibility, run that exact stock and device matrix.
- Complete UI accessibility and Microsoft Store entitlement-adapter tests.
