# Independent final reliability review

Review date: 2026-09-19  
Candidate: 0.4.0-rc.1  
Scope: backend/domain engine and portable PDF evidence  
Verdict: **PASS — no reproducible backend release blocker remains**  
Production code changes by reviewer: none

## Executed baseline

| Command or evidence | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm test` | Superseded by final hardening recheck: Pass, 76/76 |
| Coverage | 98.57% lines, 86.26% branches, 95.26% functions after hardening |
| `npm run validate:gates` | Pass, `ENGINE_READY_FOR_EXTERNAL_VERIFICATION` |
| `npm run harness -- demo` | Pass; schema 7 and hashed print attempt emitted |
| Scenario matrix | Pass; 20 live cases, 20 samples, five localized calibration sheets, two partial three-up sheets |
| Acceptance matrix | Pass; printed US, printed Canadian, nothing-sent and uncertain-output paths |

## Findings discovered and closed

| Adversarial finding | Closure |
|---|---|
| Single-check outcome calls could partially resolve a multi-cheque document | Single-check calls now reject shared documents atomically; `resolvePrintDocumentOutcome` is the only shared-sheet path. |
| Ready status was not bound to the profile that passed render validation | The exact profile ID is stored, required at queueing and protected from edit while referenced. |
| Durable queue return type omitted the immutable plan hash | The durable result exposes the hash required by the exact-print host boundary. |
| Default scenario output collided with an existing evidence directory | Default runs now use a timestamped directory; stable `--out` paths must be empty. |
| Canadian French sample/calibration furniture remained English | Sample labels, number, overlay, calibration instructions and measurement text use `fr-CA`. |
| Acceptance evidence omitted the plan hash | `result.json` contains the exact 64-character SHA-256 plan hash. |
| New Ready binding was added without a compatible persisted-state version | State is schema 7; schemas 1–6 migrate explicitly with audited profile recovery or conservative Ready demotion. |
| A broken owner's delayed heartbeat could overwrite a replacement lock | Owner files are immutable; token-specific heartbeat sidecars cannot overwrite another owner. A 300-cycle independent race probe had zero losses. |
| Schema 1–3 could migrate a state whose terminal audit binding was broken | Legacy terminal state hashes are verified before transformation. |
| Three-up slots could be aliased with whitespace or rolled back by restore | IDs are normalized before lookup, and the separate encrypted guard preserves ordered reservation/use/release events, including equal timestamps. |
| Fixed-secret evidence could enter `npm pack` | Runners remove transient state, `.npmignore` excludes all runtime artifacts, and the executable gate rejects a dirty package inventory. |

## Final independent probes

| Invariant | Result |
|---|---|
| Authenticated schema-5 `READY` without an attempt | Safely becomes `DRAFT`; audit lists the demoted ID |
| Schema-5 `READY` with a `NOT_SENT` attempt | Remains `READY` with the exact attempt profile |
| Schema-5 `PRINTED` with another account profile present | Restores the exact used profile, not an arbitrary profile |
| Schema 1, 2, 3, 4, 5 and 6 records | Migrate to schema 7 with exact used profile where provable and the correct migration audit ID |
| Shared three-up single-check confirmation | Rejects with complete-state rollback |
| Shared three-up document confirmation | Commits all three checks atomically |
| Number uniqueness, plan hash, printer and stock identity | Preserved through queue, save, reload and outcome |
| Additional fractional calibration profiles | 6,751 accepted combinations remained within 612 × 792 points |

## Residual external gates

- Windows renderer and native Print to PDF/print-dialog adapter.
- Microsoft Store purchase, restoration, cancellation and offline behavior.
- Finished UI, keyboard/screen-reader/high-contrast/text-scaling evidence.
- Ruler alignment on actual stock and any named printer/stock compatibility claim.
- Financial-institution qualification where required.

These are not backend failures and are not represented as tested.
