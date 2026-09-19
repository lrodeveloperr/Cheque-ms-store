# Evidence dossier

Research date: 2026-09-19

## Microsoft Store demand signal

The live Store showed `Print Checks Pro` at #9 in US Business best-selling with a 3.5/5 rating from 25 ratings and a $29.99 price; it also appeared at #16 in Canadian Business best-selling at CAD $38.99. That combination validates paid demand while leaving room for a more reliable experience. Search results also exposed a weak incumbent set: `Check Print’R +` at 1.8/5, `Print Checks Deluxe` at 3.0/5, `Check Writer & Printer` at 1.0/5, and `Print Checks` at 2.7/5. A new subscription entrant, `Simply Print Checks`, released 2026-08-21, means a one-time, local-first position needs to be explicit.

Sources: [US Business best-selling](https://apps.microsoft.com/collections/computed/apps/topgrossing/business?hl=en-US&gl=US), [Canadian Business best-selling](https://apps.microsoft.com/collections/computed/apps/topgrossing/business?hl=en-CA&gl=CA), [Print Checks Pro](https://apps.microsoft.com/detail/9nqltzq0s17z?hl=en-US&gl=US), [Microsoft Store check-printing search](https://apps.microsoft.com/search?query=check%20printing&hl=en-US&gl=US), [Simply Print Checks](https://apps.microsoft.com/detail/9nmplzjvfhm3?hl=en-US&gl=US).

## Evidence-to-feature mapping

| Observed customer/market problem | Engine response | Residual risk |
|---|---|---|
| Low ratings despite chart position | Explicit lifecycle, error-safe recovery, no silent completion | Needs physical printer validation |
| Alignment is a make-or-break workflow | Named calibration profiles, test sheet, bounded offsets and scale | Driver margins vary |
| Users need records after printing | Local register, clearing, CSV export, immutable attempt history | Full accounting integration is deferred |
| Subscriptions weaken trust for occasional use | Three-check proof tier plus one-time Lifetime entitlement | Store receipt adapter is host work |
| Financial data is sensitive | No cloud/account/telemetry; authenticated encrypted state and backups | Host must protect the key |
| Blank-stock printing creates compliance and printer variability | Preprinted stock only; no MICR fields in the model or print plan | Narrows addressable audience intentionally |

## Platform boundary

Microsoft documents Windows printer integration separately from app domain logic. This candidate therefore stops at an exact, device-independent `PrintPlan`; the later Windows shell must validate printer capabilities and render through supported Windows printing APIs. [Microsoft Print Support App design guidance](https://learn.microsoft.com/windows-hardware/drivers/devapps/print-support-app-design-guide).

## Confidence

- Demand and weak-rating signal: high, directly observed in live US/Canadian Store surfaces.
- Workflow contract: medium-high, grounded in the common draft/calibrate/print/confirm/register flow and incumbent failure patterns.
- Physical alignment across printers: provisional until the frozen fixtures are run on representative inkjet/laser devices and every advertised voucher/three-up stock profile.
