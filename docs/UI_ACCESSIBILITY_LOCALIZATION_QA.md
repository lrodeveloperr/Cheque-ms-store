# Operations Desk UI — Localization and Accessibility QA

Status: implementation contract for the selected Operations Desk interface  
Launch locales: `en-US`, `en-CA`, `fr-CA`  
Scope boundary: UI presentation only. The locked engine and approved PDF renderer remain authoritative.

## Integration contract

The UI must load the three JSON resources, create one `UiCatalogBundle`, and pass it to `createUiLocalizer` from `windows-host/src/ui/i18n.ts`. The renderer must never concatenate a date, number, amount or translated sentence.

```ts
const i18n = createUiLocalizer(catalogs, savedLocale ?? navigator.language);

heading.textContent = i18n.text("dashboard.title");
resultCount.textContent = i18n.count("register.results", visibleRows.length);
amount.textContent = i18n.moneyFromMinorUnits(record.amountMinor, record.currency);
issued.textContent = i18n.date(record.issueDate);
```

Controller responsibilities:

1. Store only the selected locale code (`en-US`, `en-CA` or `fr-CA`), never translated text.
2. Pass raw values to the renderer: ISO date-only strings, integer minor-unit money and ISO currency codes.
3. Pass parameters as named values. Do not build fragments such as `count + " checks"`.
4. Switch catalogs immediately when the user changes language; no restart is required.
5. Fall back to `en-US` for an unknown Windows locale. `en-CA` inherits `en-US` and applies Canadian terminology overrides.
6. Call `validateUiCatalogs` in tests and at development startup. A production build must not ship with validation failures.
7. Use `findHardCodedLocaleSensitiveLiterals` in CI to prevent fixed currency, date and decimal examples from entering UI catalogs.

The shell and workflow renderer must import accessibility metadata from `windows-host/src/ui/accessibility.ts`:

- use `OPERATIONS_DESK_LANDMARKS` for the sidebar, main workspace, filter/search region and readiness panel;
- use `REGISTER_COLUMNS` to apply localized labels and `aria-sort` to register headers;
- use `stateAnnouncement` for live-region role, politeness and error-summary focus;
- use `FocusRestorationStack` for dialogs, file pickers and confirmation surfaces;
- use `nextRovingIndex` for sidebar, tab and compact table control navigation;
- use `normalizeDisplayPreferences` to reflect Windows forced colours, reduced motion and text scaling;
- validate action metadata with `validateAccessibilityContracts`.

## Localization checklist

| ID | Requirement | Automated evidence | Manual evidence |
|---|---|---|---|
| L10N-001 | Every `en-US` key exists in `fr-CA`; Canadian overrides contain no unknown keys. | `validateUiCatalogs` | — |
| L10N-002 | Named placeholders match across locales. | `validateUiCatalogs` | Review values in context. |
| L10N-003 | Singular and plural count keys use `Intl.PluralRules`. | plural tests | Check 0, 1, 2 and large counts on screen. |
| L10N-004 | Dates use `Intl.DateTimeFormat`; date-only values cannot shift by time zone. | formatter tests | Compare Windows regional settings. |
| L10N-005 | Numbers and USD/CAD amounts use `Intl.NumberFormat`; no hand-built `$` strings. | formatter and literal-scan tests | Check USD under `en-CA` and CAD under `en-US`. |
| L10N-006 | United States uses “check”; Canadian English uses “cheque”; French uses “chèque”. | terminology tests | Review all headings, empty states and confirmations. |
| L10N-007 | French uses banking terms consistently: `bénéficiaire`, `compensé`, `gâché`, `papier-chèque`, `talon`. | terminology tests | Fluent Quebec French review required before Store submission. |
| L10N-008 | No user-facing string lives in HTML, renderer/controller source or engine error text. | source audit before release | Navigate every route in all three locales. |
| L10N-009 | Errors say what failed, what remains safe and what to do next. | catalog parity | Trigger every error fixture. |
| L10N-010 | Store price is a runtime Microsoft-formatted string inserted through `{price}`. | placeholder test | Store sandbox validation at submission time. |
| L10N-011 | Long French text wraps without clipping at 200% text. | — | Visual QA at 100%, 150% and 200%. |
| L10N-012 | PDF content locale remains controlled by the locked renderer; UI translation cannot alter PDF geometry. | existing PDF integrity suite | Compare approved golden PDFs. |

## Accessibility checklist

### Structure and navigation

- [ ] Exactly one labelled `main` landmark and one level-one heading exist per route.
- [ ] The dark Operations Desk sidebar is a labelled navigation landmark; the selected route is exposed with `aria-current="page"`.
- [ ] Compact readiness metrics have full accessible names and explicit state text. Colour is supplementary.
- [ ] Search and filters form a labelled search landmark. The result count is announced after filters settle.
- [ ] All actions are reachable in a logical Tab sequence; arrow-key navigation does not trap Tab focus.
- [ ] `Ctrl+N`, `Ctrl+P` and `Ctrl+Shift+S` work only where safe and never bypass validation or confirmation.
- [ ] Focus remains visibly obvious in forced-colours mode.

### Register table

- [ ] The register uses a real table with a caption, column headers and row headers where appropriate.
- [ ] Sortable headers are buttons and expose `aria-sort`; changes announce column and direction.
- [ ] Filters announce one result, multiple results and zero results without moving focus.
- [ ] Keyboard users can inspect every cell and reach row actions without hidden hover-only controls.
- [ ] At 200% text, the table may scroll inside its named region; the full page must not acquire horizontal scrolling.
- [ ] Status is expressed with text (`Printed`, `Cleared`, `Voided`, `Spoiled`), not colour alone.

### Forms and validation

- [ ] Every control has a visible label. Optional fields are identified; required fields expose programmatic required state.
- [ ] Help and error text are connected with `aria-describedby`.
- [ ] Invalid submission focuses a titled error summary whose links move focus to each invalid field.
- [ ] Amount, date and number instructions are announced before validation, not only after failure.
- [ ] Autocomplete payee results expose count, active option and selection.
- [ ] Exact PDF preview has a localized text summary containing number, payee, amount and date.

### Consequential actions

- [ ] Delete, archive, restore and spoiled-check actions use a titled confirmation and state the irreversible consequence.
- [ ] Print result choices expose their consequence text before activation.
- [ ] After a modal closes, focus returns to its original trigger; if that trigger no longer exists, focus moves to the page heading.
- [ ] A pending print result is announced and cannot be bypassed by keyboard shortcuts.
- [ ] The paywall never blocks access to records, backup, export, pending outcomes or purchase restoration.

### Windows display and assistive technology

- [ ] Test Narrator with keyboard only on setup, first sample, live print, print outcome, register filtering and backup restore.
- [ ] Test Windows High Contrast themes. Selected sidebar item, focus, fields, borders, warnings and charts remain distinguishable.
- [ ] Test Windows text size at 200% with display scaling at 100%, 150% and 200%.
- [ ] Honour `prefers-reduced-motion`; remove sliding and decorative transitions while retaining immediate state changes.
- [ ] Touch targets remain at least 40 by 40 CSS pixels even in dense tables and sidebars.
- [ ] Do not use tooltips as the sole source of a label, error or consequence.

## Required route matrix

Each row must pass keyboard, Narrator, forced-colours, 200% text, `en-US`, `en-CA` and `fr-CA` checks.

| Area | Required scenarios |
|---|---|
| Startup and setup | fresh file, recovered session, country/currency, account, layout, printer, calibration, plain-paper sample |
| Operations desk | ready, incomplete, pending outcome, free allowance, Lifetime active, no recent activity |
| New cheque | saved/new payee, validation, duplicate warning, fit errors, exact preview, physical-number confirmation |
| Output | sample, save PDF, live print, unavailable printer, integrity refusal, stock position |
| Print result | correct, paper marked/problem, nothing printed, uncertain result, replacement |
| Register | empty, populated, search, every filter, sort, mark cleared/not cleared, export |
| Payees | empty, add/edit/archive, CSV preview, duplicates and row errors |
| Settings | accounts, stock, calibration, language, purchase, privacy, backup and restore |
| Help | first-cheque guide, scaling, MICR limitation, diagnostics and support |

## Exit gate

The UI accessibility/localization layer is ready to merge when:

1. Typecheck and `windows-host/test/ui/i18n-accessibility.test.ts` pass.
2. Catalog validation returns zero issues and all user-facing workflow keys resolve in all launch locales.
3. The source audit finds no hard-coded UI strings or locale-sensitive formatting in renderer/controller files.
4. Keyboard and Narrator can complete the first-sample path, live-print path, conservative print-outcome path and restore path.
5. Forced colours and 200% text cause no loss of information or blocked action.
6. A fluent Quebec French reviewer approves visible terminology in the functioning UI.
7. The existing PDF integrity and golden-image suites remain unchanged and green.
