# Host/PDF integration verification brief

Review the candidate as if you are an independent engineer with no access to its authoring conversation.

## Evidence you receive

- `docs/EVIDENCE_DOSSIER.md`
- `docs/PRODUCT_CONTRACT.md`
- `gate-manifest.json`
- source, tests, fixtures/localizations, and the CLI harness

## Required checks

1. Run `npm test`, `npm run validate:gates`, `npm run harness -- demo`, and `npm run scenarios` on Node 24+ before integration.
2. Acquire the instance lock for the selected data file and await every durable queue operation.
3. Render calibration and sample plans to Microsoft Print to PDF at 100%/Actual Size; compare the resulting page with frozen expected fixtures.
4. Verify all text roles, three-up start slots, warning keys, and sample overlays are rendered exactly. Use the generated SHA-256 manifest to keep evidence tied to this candidate.
5. Pass the durably queued plan hash into `exactPrintJob`. Map the Windows outcome UI to printed correctly, printed/unknown, or nothing printed, then resolve the matching document ID and plan hash once so every cheque on a sheet commits atomically.
6. Exercise fresh restore and confirm that number confirmation is required before draft issue or queue.
7. Confirm localized message keys are used instead of developer diagnostics.
8. Only if named physical compatibility will be marketed, validate the exact paper/printer combinations separately. Do not use real account/routing numbers.

## Report format

Return `PASS`, `FAIL`, or `BLOCKED` per host requirement with the generated PDF fixture, reproduction steps, severity, confidence, and smallest safe fix. Candidate 0.4.0-rc.1 is intentionally open for stock-layout/calibration acceptance; any further engine-contract change must restart the affected checks.
