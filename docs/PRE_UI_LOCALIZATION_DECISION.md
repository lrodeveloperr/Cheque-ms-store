# Localization decision before UI

## Launch locales

- `en-US`: United States, USD, “check”.
- `en-CA`: Canada, CAD or marked USD, “cheque”.
- `fr-CA`: Canada, CAD or marked USD, Quebec-natural cheque vocabulary.

All three include onboarding, actions, Store commerce, errors, state recovery, privacy summaries, output warnings and print outcomes. Printed cheque language remains frozen per cheque by the engine.

## `es-US`: deferred

American Spanish is **not** a launch locale. This is a product-safety decision, not a translation-cost decision:

1. The available direct Microsoft Store evidence validates paid US/Canadian cheque-printing demand but does not establish a material Spanish-first purchaser segment for this narrow Windows business utility.
2. Spanish UI alone would be incomplete. A supported cheque locale also requires native amount words, cheque/legal terminology, exact font fit, golden PDFs, support copy, store metadata and reviewer evidence.
3. The current engine accepts only `en-US`, `en-CA` and `fr-CA`; advertising Spanish before that complete path exists would violate the promise that supported languages provide a reasonably similar experience.
4. Canadian French has a direct jurisdictional and competitive rationale in the launch market. Spanish presently has broad population relevance but no product-specific evidence strong enough to justify increasing the financial-output QA matrix before release.

Revisit `es-US` after either (a) repeated customer requests with purchase intent, (b) Store search/conversion evidence from Spanish-language discovery, or (c) a distributor requiring it. Entry requires fluent review, Spanish amount-word tests, font/fit matrices and full Store localization; it must not fall back to English in financial-output paths.

Microsoft Store policy requires the product and listing to be localized for every language declared: [Microsoft Store Policies, section 10.7](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies).
