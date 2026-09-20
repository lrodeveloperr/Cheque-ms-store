import { appendFileSync, existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
} from "electron";
import { localize } from "../../../src/localization.ts";
import type { NativePrintOutcome } from "../../../src/host-contract.ts";
import type { AppLocale } from "../../../src/types.ts";
import type { PrintSubmission } from "../platform/contracts.ts";
import type { PartnerCenterIdentity } from "../product/product-identity.ts";
import { PreUiApplicationBridge } from "./ui-bridge.ts";
import { openPreUiApplication, type PreUiApplication } from "./pre-ui-host.ts";
import { FileUiStateStore } from "./ui-session-store.ts";
import { DesktopUiRuntime, type UiRuntimeFilePicker } from "./ui-runtime.ts";
import { UiWorkflowController } from "../ui/controller.ts";
import type { UiActionRequest } from "../ui/ipc-contract.ts";
import type { UiCatalog, UiCatalogBundle } from "../ui/i18n.ts";
import { RuntimeStartup } from "./runtime-startup.ts";

const APP_USER_MODEL_ID = "WorksBienStudios.CheckPrinterCheckWriter";
const APP_TITLE = "Check Printer & Check Writer";
const moduleDirectory = dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | undefined;
let application: PreUiApplication | undefined;
const runtimeStartup = new RuntimeStartup<DesktopUiRuntime>((error) => {
  traceStartupSelfTest("RUNTIME_FAILURE", error);
  console.error("Application runtime initialization failed.", error);
  if (!startupSelfTestEnabled() && app.isReady()) {
    dialog.showErrorBox(
      APP_TITLE,
      "The app could not initialize its protected local data. No cheque data was changed.",
    );
  }
  void exitApplication(1);
});
let shutdownStarted = false;

function startupSelfTestEnabled(): boolean {
  return process.env.WORKSBIEN_STARTUP_SELF_TEST === "1"
    || process.argv.includes("--worksbien-startup-self-test");
}

function startupSelfTestLogPath(): string | undefined {
  const argument = process.argv.find((value) => value.startsWith("--worksbien-startup-self-test-log="));
  return process.env.WORKSBIEN_STARTUP_SELF_TEST_LOG
    ?? argument?.slice("--worksbien-startup-self-test-log=".length);
}

function traceStartupSelfTest(phase: string, error?: unknown): void {
  const path = startupSelfTestLogPath();
  if (!path) return;
  const detail = error instanceof Error
    ? ` ${error.name}: ${error.message}`
    : error === undefined ? "" : ` ${String(error)}`;
  try { appendFileSync(path, `${new Date().toISOString()} ${phase}${detail}\n`, "utf8"); }
  catch { /* Diagnostics must never change application startup. */ }
}

traceStartupSelfTest("MODULE_LOADED");

async function exitApplication(code: number): Promise<void> {
  if (shutdownStarted) return;
  traceStartupSelfTest(`EXIT_BEGIN_${code}`);
  shutdownStarted = true;
  const openedApplication = application;
  application = undefined;
  if (openedApplication) await openedApplication.close().catch(() => undefined);
  traceStartupSelfTest(`EXIT_APPLICATION_CLOSED_${code}`);
  app.exit(code);
}

function resolveUiFile(): string {
  const candidates = [
    join(moduleDirectory, "../ui/index.html"),
    join(process.resourcesPath, "ui/index.html"),
    join(app.getAppPath(), "src/ui/index.html"),
  ];
  const resolved = candidates.find((candidate) => existsSync(candidate));
  if (!resolved) throw new Error("The packaged application is missing its UI entry file.");
  return resolved;
}

function resolveLocalizationDirectory(): string {
  const candidates = [
    join(moduleDirectory, "../../localization"),
    join(process.resourcesPath, "localization"),
    join(app.getAppPath(), "localization"),
  ];
  const resolved = candidates.find((candidate) => existsSync(join(candidate, "en-US.json")));
  if (!resolved) throw new Error("The packaged application is missing its localization catalogs.");
  return resolved;
}

async function readCatalog(path: string): Promise<UiCatalog> {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid UI localization catalog.");
  }
  return value as UiCatalog;
}

async function loadUiCatalogs(): Promise<UiCatalogBundle> {
  const directory = resolveLocalizationDirectory();
  const [enUS, enCAOverrides, frCA] = await Promise.all([
    readCatalog(join(directory, "en-US.json")),
    readCatalog(join(directory, "en-CA.overrides.json")),
    readCatalog(join(directory, "fr-CA.json")),
  ]);
  return { enUS, enCAOverrides, frCA };
}

function ownerWindow(): BrowserWindow {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error("The application window is not available.");
  return mainWindow;
}

function nativeWindowHandle(window: BrowserWindow): number {
  const bytes = window.getNativeWindowHandle();
  if (bytes.length >= 8) {
    const value = Number(bytes.readBigUInt64LE(0));
    return Number.isSafeInteger(value) ? value : 0;
  }
  return bytes.length >= 4 ? bytes.readUInt32LE(0) : 0;
}

function partnerCenterIdentity(): PartnerCenterIdentity {
  return {
    packageIdentityName: process.env.WORKSBIEN_PACKAGE_IDENTITY_NAME ?? APP_USER_MODEL_ID,
    packageFamilyName: process.env.WORKSBIEN_PACKAGE_FAMILY_NAME ?? "not-store-associated",
    publisherSubject: process.env.WORKSBIEN_PUBLISHER_SUBJECT ?? "not-store-associated",
    appStoreId: process.env.WORKSBIEN_APP_STORE_ID ?? "000000000000",
    lifetimeAddOnStoreId: process.env.WORKSBIEN_LIFETIME_STORE_ID ?? "000000000001",
  };
}

function storeAssociated(identity: PartnerCenterIdentity): boolean {
  return app.isPackaged
    && process.env.WORKSBIEN_STORE_ASSOCIATED === "1"
    && identity.packageFamilyName !== "not-store-associated"
    && identity.publisherSubject !== "not-store-associated"
    && identity.appStoreId !== "000000000000"
    && identity.lifetimeAddOnStoreId !== "000000000001";
}

async function confirmPhysicalOutcome(locale: AppLocale): Promise<NativePrintOutcome> {
  const response = await dialog.showMessageBox(ownerWindow(), {
    type: "question",
    title: APP_TITLE,
    message: localize(locale, "print.confirmPrompt"),
    detail: localize(locale, "print.actualSizeWarning"),
    buttons: [
      localize(locale, "print.outcome.correct"),
      localize(locale, "print.outcome.problem"),
      localize(locale, "print.outcome.notPrinted"),
    ],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (response.response === 0) return { kind: "PRINTED_CORRECTLY" };
  if (response.response === 2) {
    return {
      kind: "NOT_PRINTED",
      reasonCode: "OPERATOR_CONFIRMED_NO_OUTPUT",
      deliveryEvidence: "HOST_CONFIRMED_NO_OUTPUT",
    };
  }
  return { kind: "PAPER_MARKED_WITH_PROBLEM", reasonCode: "OPERATOR_REPORTED_PROBLEM" };
}

async function confirmUnknownLetter(): Promise<boolean> {
  const response = await dialog.showMessageBox(ownerWindow(), {
    type: "warning",
    title: "Confirm Letter paper support",
    message: "Windows could not verify that this printer supports US Letter paper.",
    detail: "Continue only if the selected printer is loaded with 8.5 × 11 inch Letter paper.",
    buttons: ["Cancel", "Continue"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  return response.response === 1;
}

function filePicker(): UiRuntimeFilePicker {
  return {
    async savePdf(suggestedName) {
      const result = await dialog.showSaveDialog(ownerWindow(), {
        title: "Save exact PDF",
        defaultPath: suggestedName,
        filters: [{ name: "PDF document", extensions: ["pdf"] }],
      });
      return result.canceled ? undefined : result.filePath;
    },
    async saveCsv(suggestedName) {
      const result = await dialog.showSaveDialog(ownerWindow(), {
        title: "Export check register",
        defaultPath: suggestedName,
        filters: [{ name: "CSV document", extensions: ["csv"] }],
      });
      return result.canceled ? undefined : result.filePath;
    },
    async saveBackup(suggestedName) {
      const result = await dialog.showSaveDialog(ownerWindow(), {
        title: "Create encrypted backup",
        defaultPath: suggestedName,
        filters: [{ name: "WorksBien backup", extensions: ["wbc"] }],
      });
      return result.canceled ? undefined : result.filePath;
    },
    async openBackup() {
      const result = await dialog.showOpenDialog(ownerWindow(), {
        title: "Restore encrypted backup",
        properties: ["openFile"],
        filters: [{ name: "WorksBien backup", extensions: ["wbc"] }],
      });
      return result.canceled ? undefined : result.filePaths[0];
    },
  };
}

async function writeTextAtomically(destinationPath: string, contents: string): Promise<void> {
  await mkdir(dirname(destinationPath), { recursive: true });
  const temporaryPath = `${destinationPath}.tmp`;
  await writeFile(temporaryPath, contents, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, destinationPath);
}

async function createRuntime(): Promise<DesktopUiRuntime> {
  traceStartupSelfTest("RUNTIME_BEGIN");
  const identity = partnerCenterIdentity();
  traceStartupSelfTest("STATE_OPEN_BEGIN");
  application = await openPreUiApplication({
    userDataDirectory: app.getPath("userData"),
    temporaryDirectory: join(app.getPath("temp"), "worksbien-check-printer"),
    safeStorage,
    BrowserWindow,
    localizePdf: localize,
    confirmOutcome: {
      confirmPhysicalOutcome: async (job, _submission: Extract<PrintSubmission, { kind: "SUBMITTED" }>) =>
        confirmPhysicalOutcome(job.plan.locale),
    },
    confirmUnknownLetter: { confirmUnverifiedLetterCapability: () => confirmUnknownLetter() },
    bridgeExecutablePath: join(process.resourcesPath, process.arch, "WorksBien.StoreBridge.exe"),
    partnerCenterIdentity: identity,
    ownerHwnd: startupSelfTestEnabled() ? 0 : nativeWindowHandle(ownerWindow()),
    packaged: app.isPackaged,
    storeAssociated: storeAssociated(identity),
  });
  traceStartupSelfTest("STATE_OPEN_COMPLETE");
  await application.initializeCommerce();
  traceStartupSelfTest("COMMERCE_COMPLETE");
  const files = {
    createBackup: (intent: { destinationPath: string; recoveryPassphrase: string }) =>
      application!.createBackup(intent.destinationPath, intent.recoveryPassphrase),
    restoreBackup: (intent: { sourcePath: string; backupPassphrase: string }) =>
      application!.restoreBackup(intent.sourcePath, intent.backupPassphrase).then(() => undefined),
    writeText: writeTextAtomically,
  };
  const bridge = new PreUiApplicationBridge(application, files);
  const stateStore = new FileUiStateStore(join(app.getPath("userData"), "ui-session.json"));
  const runtime = new DesktopUiRuntime(new UiWorkflowController(bridge, stateStore), filePicker());
  traceStartupSelfTest("RUNTIME_COMPLETE");
  return runtime;
}

function createMainWindow(loadUi = true): BrowserWindow {
  const window = new BrowserWindow({
    title: APP_TITLE,
    width: 1280,
    height: 840,
    minWidth: 800,
    minHeight: 600,
    show: false,
    useContentSize: true,
    autoHideMenuBar: true,
    backgroundColor: "#F3F6F8",
    webPreferences: {
      preload: join(moduleDirectory, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: true,
      devTools: !app.isPackaged,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  if (loadUi) window.once("ready-to-show", () => window.show());
  window.on("closed", () => { if (mainWindow === window) mainWindow = undefined; });
  if (loadUi) {
    void window.loadFile(resolveUiFile()).catch(() => {
      window.destroy();
      void exitApplication(1);
    });
  }
  return window;
}

function focusExistingWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

if (!app.requestSingleInstanceLock({ product: APP_TITLE })) {
  app.quit();
} else {
  app.on("second-instance", focusExistingWindow);
  ipcMain.handle("app:get-version", () => app.getVersion());
  ipcMain.handle("app:get-ui-catalogs", () => loadUiCatalogs());
  ipcMain.handle("app:renderer-ready", () => undefined);
  ipcMain.handle("ui:initialize", async () => (await runtimeStartup.require()).initialize());
  ipcMain.handle("ui:action", async (_event, request: UiActionRequest) => (await runtimeStartup.require()).perform(request));

  void app.whenReady().then(async () => {
    traceStartupSelfTest("APP_READY");
    app.setAppUserModelId(APP_USER_MODEL_ID);
    if (!startupSelfTestEnabled()) {
      mainWindow = createMainWindow();
      traceStartupSelfTest("WINDOW_CREATED");
    }
    const runtime = runtimeStartup.start(createRuntime);
    if (startupSelfTestEnabled()) {
      traceStartupSelfTest("UI_INITIALIZE_BEGIN");
      await (await runtime).initialize();
      traceStartupSelfTest("UI_INITIALIZE_COMPLETE");
      await exitApplication(0);
      return;
    }
    app.on("activate", () => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        mainWindow = createMainWindow();
        runtimeStartup.start(createRuntime);
      } else focusExistingWindow();
    });
  }).catch((error: unknown) => {
    console.error("Application startup failed.", error);
    void exitApplication(1);
  });

  app.on("before-quit", (event) => {
    if (!application || shutdownStarted) return;
    event.preventDefault();
    shutdownStarted = true;
    void application.close().finally(() => app.quit());
  });
  app.on("window-all-closed", () => app.quit());
}
