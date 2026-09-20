import assert from "node:assert/strict";
import test from "node:test";
import { STOCK_KEYS } from "../../../src/calibration.ts";
import { createDevelopmentUiBridge, MemoryUiApplicationBridge } from "../../src/application/ui-bridge.ts";
import { MemoryUiStateStore, initialUiSession, type UiSessionState } from "../../src/ui/app-model.ts";
import { UiWorkflowController, nothingPrinted, paperMarkedWithProblem, printedCorrectly } from "../../src/ui/controller.ts";
import { payeesModel } from "../../src/ui/features/settings.ts";

const NOW = "2026-09-19T12:00:00.000Z";

async function configuredFixture() {
  const bridge = new MemoryUiApplicationBridge({ now: () => NOW });
  const account = await bridge.createAccount({
    name: "Operating",
    companyName: "WorksBien Test",
    currency: "USD",
    bankCountry: "US",
    locale: "en-US",
    nextCheckNumber: 1001,
  });
  const payee = await bridge.createPayee({ name: "Northwind Supplies", defaultMemo: "Invoice 1042" });
  const profile = await bridge.createCalibration({
    accountId: account.id,
    name: "PDF voucher top",
    printerKey: "Microsoft Print to PDF",
    layout: "VOUCHER_TOP",
  });
  const session: UiSessionState = {
    ...initialUiSession("en-US"),
    route: "HOME",
    selectedAccountId: account.id,
    selectedCalibrationProfileId: profile.id,
    selectedPrinterKey: profile.printerKey,
    selectedStockKey: profile.stockKey,
    onboarding: {
      preprintedStockConfirmed: true,
      accountId: account.id,
      layout: profile.layout,
      printerKey: profile.printerKey,
      stockKey: profile.stockKey,
      startSlot: 0,
      calibrationProfileId: profile.id,
      completedAt: NOW,
    },
  };
  return { bridge, account, payee, profile, session };
}

async function readyController() {
  const fixture = await configuredFixture();
  const store = new MemoryUiStateStore(fixture.session);
  const controller = new UiWorkflowController(fixture.bridge, store, { now: () => NOW });
  await controller.initialize();
  return { ...fixture, store, controller };
}

async function createAndQueue(
  controller: UiWorkflowController,
  payeeId: string,
  amountCents = 123_456,
) {
  assert.equal((await controller.beginCheque()).ok, true);
  const created = await controller.createCheque({
    payeeId,
    issueDate: "2026-09-19",
    amountCents,
    memo: "Invoice 1042",
    category: "Supplies",
  });
  assert.equal(created.ok, true);
  const review = await controller.reviewCheque();
  assert.equal(review.ok, true);
  if (!review.ok) throw new Error("review failed");
  assert.equal(review.value.paper, "LETTER");
  assert.equal(review.value.scalePercent, 100);
  assert.equal(review.value.fitToPage, false);
  assert.deepEqual(review.value.checkIds, [created.ok ? created.value.id : ""]);
  assert.equal((await controller.openOutput()).ok, true);
  const queued = await controller.queueLiveOutput();
  assert.equal(queued.ok, true);
  return { created, queued };
}

test("first launch is resumable and completes every setup checkpoint", async () => {
  const bridge = new MemoryUiApplicationBridge({ now: () => NOW });
  const store = new MemoryUiStateStore();
  const first = new UiWorkflowController(bridge, store, { now: () => NOW });
  assert.equal((await first.initialize()).route, "ONBOARDING_WELCOME");
  assert.equal((await first.acknowledgePreprintedStock()).ok, true);
  const account = await first.saveOnboardingAccount({
    name: "Operating",
    companyName: "WorksBien Test",
    currency: "USD",
    bankCountry: "US",
    locale: "en-US",
    nextCheckNumber: 1001,
  });
  assert.equal(account.ok, true);
  assert.equal((await first.chooseOnboardingLayout("THREE_UP", 2)).ok, true);

  const resumed = new UiWorkflowController(bridge, store, { now: () => NOW });
  assert.equal((await resumed.initialize()).route, "ONBOARDING_PRINTER");
  assert.equal(resumed.session.startSlot, 2);
  assert.equal((await resumed.selectOnboardingPrinter("Microsoft Print to PDF")).ok, true);
  const calibrated = await resumed.saveOnboardingCalibration("PDF three-up");
  assert.equal(calibrated.ok, true);
  assert.equal(resumed.session.route, "HOME");
  assert.equal(resumed.view().kind, "HOME");
});

test("route guards refuse unsafe deep links without changing the current route", async () => {
  const bridge = new MemoryUiApplicationBridge({ now: () => NOW });
  const controller = new UiWorkflowController(bridge, new MemoryUiStateStore(), { now: () => NOW });
  await controller.initialize();
  const blocked = await controller.navigate("CHEQUE_NEW");
  assert.equal(blocked.ok, false);
  if (blocked.ok) throw new Error("guard unexpectedly allowed route");
  assert.equal(blocked.kind, "BLOCKED");
  assert.equal(blocked.message.key, "ui.route.accountRequired");
  assert.equal(controller.session.route, "ONBOARDING_WELCOME");
});

test("core cheque journey uses exact preview, durable queue and all three outcomes", async () => {
  const printed = await readyController();
  const first = await createAndQueue(printed.controller, printed.payee.id);
  const outcome = await printed.controller.recordPendingOutcome(printedCorrectly());
  assert.equal(outcome.ok, true);
  assert.equal(printed.controller.session.route, "CHEQUE_SUCCESS");
  assert.equal(printed.bridge.snapshot().freeUsageCount, 1);

  const spoiled = await createAndQueue(printed.controller, printed.payee.id, 22_000);
  const marked = await printed.controller.recordPendingOutcome(paperMarkedWithProblem("ALIGNMENT"));
  assert.equal(marked.ok, true);
  if (!marked.ok) throw new Error("outcome failed");
  assert.equal(marked.value[0]?.status, "MISPRINTED");
  const replacement = await printed.controller.replaceSpoiled(marked.value[0]!.id);
  assert.equal(replacement.ok, true);
  if (!replacement.ok) throw new Error("replacement failed");
  assert.equal(replacement.value.replacementForCheckId, marked.value[0]!.id);

  await printed.controller.reviewCheque();
  await printed.controller.openOutput();
  await printed.controller.queueLiveOutput();
  const none = await printed.controller.recordPendingOutcome(nothingPrinted("CANCELLED", "HOST_CANCELLED_BEFORE_SUBMIT"));
  assert.equal(none.ok, true);
  assert.equal(printed.bridge.snapshot().checks.find((check) => check.id === replacement.value.id)?.status, "READY");
  assert.equal(printed.bridge.snapshot().freeUsageCount, 2);
  assert.equal(first.queued.ok && spoiled.queued.ok, true);
});

test("a queued document is recovered on restart before any new cheque", async () => {
  const fixture = await readyController();
  await createAndQueue(fixture.controller, fixture.payee.id);
  assert.equal(fixture.bridge.snapshot().checks.some((check) => check.status === "PRINT_QUEUED"), true);

  const restarted = new UiWorkflowController(fixture.bridge, fixture.store, { now: () => NOW });
  const view = await restarted.initialize();
  assert.equal(view.kind, "PRINT_OUTCOME");
  assert.equal(restarted.session.route, "PRINT_OUTCOME");
  const blocked = await restarted.beginCheque();
  assert.equal(blocked.ok, false);
  assert.equal((await restarted.recordPendingOutcome(printedCorrectly())).ok, true);
});

test("three live cheques exhaust Free while samples and calibration remain unlimited", async () => {
  const fixture = await readyController();
  for (let index = 0; index < 3; index++) {
    await createAndQueue(fixture.controller, fixture.payee.id, 10_000 + index);
    assert.equal((await fixture.controller.recordPendingOutcome(printedCorrectly())).ok, true);
  }
  assert.equal(fixture.bridge.snapshot().freeUsageCount, 3);

  await fixture.controller.beginCheque();
  await fixture.controller.createCheque({
    payeeId: fixture.payee.id,
    issueDate: "2026-09-19",
    amountCents: 20_000,
  });
  const fourth = await fixture.controller.reviewCheque();
  assert.equal(fourth.ok, false);
  if (fourth.ok) throw new Error("fourth free cheque unexpectedly became printable");
  assert.equal(fourth.code, "ENTITLEMENT_REQUIRED");

  const before = fixture.bridge.snapshot();
  for (let index = 0; index < 5; index++) {
    const sample = await fixture.controller.sampleJob();
    const calibration = await fixture.controller.calibrationJob();
    assert.equal(sample.ok, true);
    assert.equal(calibration.ok, true);
    if (sample.ok) assert.equal(sample.value.plan.documentKind, "SAMPLE");
    if (calibration.ok) assert.equal(calibration.value.plan.documentKind, "CALIBRATION");
  }
  const after = fixture.bridge.snapshot();
  assert.equal(after.freeUsageCount, before.freeUsageCount);
  assert.equal(after.revision, before.revision);
});

test("register, payee management, CSV and unavailable OS data intents are explicit", async () => {
  const fixture = await readyController();
  const imported = await fixture.controller.importPayees(
    "Name,Address,City,State,Zip,Country\r\nContoso,1 Main Street,Buffalo,NY,14201,US\r\n",
  );
  assert.equal(imported.ok, true);
  if (!imported.ok) throw new Error("import failed");
  assert.equal(imported.value.created.length, 1);
  const updated = await fixture.controller.updatePayee(imported.value.created[0]!.id, { defaultMemo: "Monthly" });
  assert.equal(updated.ok, true);
  assert.equal((await fixture.controller.archivePayee(imported.value.created[0]!.id)).ok, true);

  await createAndQueue(fixture.controller, fixture.payee.id);
  await fixture.controller.recordPendingOutcome(printedCorrectly());
  assert.equal((await fixture.controller.navigate("REGISTER")).ok, true);
  assert.equal((await fixture.controller.setRegisterQuery({ statuses: ["PRINTED"], sortBy: "checkNumber", direction: "ASC" })).ok, true);
  const model = fixture.controller.view();
  assert.equal(model.kind, "REGISTER");
  if (model.kind !== "REGISTER") throw new Error("wrong model");
  assert.equal(model.rows.length, 1);
  assert.match(fixture.controller.exportRegisterCsv(), /Northwind Supplies/);

  const backup = await fixture.controller.createBackup({ destinationPath: "backup.wbcp", recoveryPassphrase: "correct horse battery staple" });
  const restore = await fixture.controller.restoreBackup({ sourcePath: "backup.wbcp", backupPassphrase: "correct horse battery staple" });
  const exportResult = await fixture.controller.saveRegisterCsv("register.csv");
  assert.equal(backup.ok, false);
  assert.equal(restore.ok, false);
  assert.equal(exportResult.ok, false);
  if (!backup.ok) assert.equal(backup.kind, "NOT_AVAILABLE");
});

test("stock keys presented by onboarding match the locked engine profiles", async () => {
  const bridge = new MemoryUiApplicationBridge({ now: () => NOW });
  const controller = new UiWorkflowController(bridge, new MemoryUiStateStore(), { now: () => NOW });
  await controller.initialize();
  await controller.acknowledgePreprintedStock();
  await controller.saveOnboardingAccount({
    name: "Operating", companyName: "WorksBien Test", currency: "USD", bankCountry: "US", locale: "en-US", nextCheckNumber: 1,
  });
  for (const layout of ["VOUCHER_TOP", "VOUCHER_MIDDLE", "VOUCHER_BOTTOM", "THREE_UP"] as const) {
    await controller.chooseOnboardingLayout(layout, layout === "THREE_UP" ? 2 : 0);
    assert.equal(controller.session.selectedStockKey, STOCK_KEYS[layout]);
  }
});

test("development fixture is immediately renderable without Store association", async () => {
  const bridge = createDevelopmentUiBridge("CA", "fr-CA");
  const state = bridge.snapshot();
  assert.equal(bridge.capabilities.developmentFixture, true);
  assert.equal(state.accounts[0]?.bankCountry, "CA");
  assert.equal(state.accounts[0]?.currency, "CAD");
  assert.equal(state.accounts[0]?.locale, "fr-CA");
  assert.ok(state.payees.length >= 2);
  assert.ok(state.calibrations.length >= 1);
});

test("payee lists use the selected launch locale for collation", async () => {
  const bridge = new MemoryUiApplicationBridge({ now: () => NOW });
  await bridge.createPayee({ name: "Zulu" });
  await bridge.createPayee({ name: "École" });
  const expected = bridge.snapshot().payees
    .map((payee) => payee.name)
    .sort((left, right) => left.localeCompare(right, "fr-CA"));
  assert.deepEqual(payeesModel(bridge.snapshot(), "fr-CA").payees.map((payee) => payee.name), expected);
});
