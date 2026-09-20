import { CheckPrinterEngine } from "../../../src/engine.ts";
import { exactPrintJob, type ExactPrintJob } from "../../../src/host-contract.ts";
import type { PlatformSession } from "../platform/contracts.ts";
import type { RestoreResult } from "../../../src/persistence.ts";
import {
  ElectronSafeStoragePort,
  type ElectronBrowserWindowConstructor,
  type ElectronSafeStorageLike,
} from "../platform/electron-adapters.ts";
import {
  createWindowsHostServices,
  type WindowsHostServices,
} from "../platform/host-factory.ts";
import type {
  PrintOutcomeConfirmer,
  UnknownLetterCapabilityConfirmer,
} from "../platform/contracts.ts";
import type { PdfLocalizer } from "../../../src/pdf-renderer-core.ts";
import { LifetimeEntitlementCoordinator } from "../product/entitlement.ts";
import type { CommerceActionResult, CommerceSnapshot } from "../product/entitlement.ts";
import { loadHostCatalogs } from "../product/catalog-loader.ts";
import type { MessageCatalogs } from "../product/localization.ts";
import type { PartnerCenterIdentity } from "../product/product-identity.ts";
import type { LaunchHostLocale } from "../product/product-identity.ts";
import { decidePrintAccess, type PrintAccessDecision } from "../product/print-access.ts";
import { StoreProcessAdapter } from "../product/store-process-adapter.ts";
import { createProtectedProductCacheStores } from "./protected-product-cache.ts";
import { OneShotStoreProcessTransport } from "./store-process-transport.ts";

export interface PreUiHostOptions {
  userDataDirectory: string;
  temporaryDirectory: string;
  guardDirectory?: string;
  safeStorage: ElectronSafeStorageLike;
  BrowserWindow: ElectronBrowserWindowConstructor;
  localizePdf: PdfLocalizer;
  confirmOutcome: PrintOutcomeConfirmer;
  confirmUnknownLetter: UnknownLetterCapabilityConfirmer;
  bridgeExecutablePath: string;
  partnerCenterIdentity: PartnerCenterIdentity;
  ownerHwnd: number;
  packaged: boolean;
  storeAssociated: boolean;
  now?: () => Date;
}

export class PreUiApplication {
  readonly services: WindowsHostServices;
  readonly commerce: LifetimeEntitlementCoordinator;
  readonly catalogs: MessageCatalogs;
  readonly #session: PlatformSession;
  readonly #engineHolder: { current: CheckPrinterEngine };
  #operationTail: Promise<void> = Promise.resolve();

  constructor(options: {
    services: WindowsHostServices;
    engineHolder: { current: CheckPrinterEngine };
    commerce: LifetimeEntitlementCoordinator;
    catalogs: MessageCatalogs;
    session: PlatformSession;
  }) {
    this.services = options.services;
    this.#engineHolder = options.engineHolder;
    this.commerce = options.commerce;
    this.catalogs = options.catalogs;
    this.#session = options.session;
  }

  get engine(): CheckPrinterEngine {
    return this.#engineHolder.current;
  }

  async initializeCommerce(): Promise<ReturnType<LifetimeEntitlementCoordinator["snapshot"]>> {
    return this.#runExclusive(async () => {
      const before = this.#session.state.revision;
      const result = await this.commerce.initialize();
      await this.#persistEntitlementChange(before);
      return result;
    });
  }

  async refreshCommerce(): Promise<ReturnType<LifetimeEntitlementCoordinator["snapshot"]>> {
    return this.#runExclusive(async () => {
      const before = this.#session.state.revision;
      const result = await this.commerce.refresh();
      await this.#persistEntitlementChange(before);
      return result;
    });
  }

  async purchaseLifetime(locale: LaunchHostLocale): Promise<CommerceActionResult> {
    return this.#runExclusive(async () => {
      const before = this.#session.state.revision;
      const result = await this.commerce.purchase(locale);
      await this.#persistEntitlementChange(before);
      return result;
    });
  }

  async restoreLifetime(): Promise<CommerceActionResult> {
    return this.#runExclusive(async () => {
      const before = this.#session.state.revision;
      const result = await this.commerce.restore();
      await this.#persistEntitlementChange(before);
      return result;
    });
  }

  async queueLivePrint(input: {
    checkIds: string[];
    calibrationProfileId: string;
    printerKey: string;
    stockKey: string;
    startSlot?: number;
    sheetIds?: string[];
  }): Promise<
    | { allowed: false; decision: Extract<PrintAccessDecision, { allowed: false }> }
    | {
        allowed: true;
        decision: Extract<PrintAccessDecision, { allowed: true }>;
        job: ExactPrintJob;
        attemptIds: string[];
      }
  > {
    return this.#runExclusive(async () => {
      const state = this.engine.snapshot();
      const selected = input.checkIds.map((id) => {
        const check = state.checks.find((candidate) => candidate.id === id);
        if (!check) throw new Error(`Unknown cheque: ${id}`);
        return check;
      });
      const decision = decidePrintAccess(
        "LIVE",
        {
          freeUsageCount: state.freeUsageCount,
          queuedChargeableCount: state.checks.filter(
            (check) => check.status === "PRINT_QUEUED" && !check.replacementForCheckId,
          ).length,
          isReplacement:
            selected.length > 0 &&
            selected.every((check) => Boolean(check.replacementForCheckId)),
        },
        this.commerce.snapshot(),
      );
      if (!decision.allowed) return { allowed: false, decision };
      const queued = await this.#session.queuePrint(input, state.revision);
      this.#engineHolder.current = new CheckPrinterEngine(queued.state);
      return {
        allowed: true,
        decision,
        job: exactPrintJob(queued.plan, input.printerKey, queued.planHash),
        attemptIds: queued.attemptIds,
      };
    });
  }

  async commit(expectedRevision = this.#session.state.revision): Promise<void> {
    await this.#runExclusive(() => this.#session.save(this.engine.snapshot(), expectedRevision));
  }

  async createBackup(destinationPath: string, recoveryPassphrase: string): Promise<void> {
    await this.#runExclusive(() => this.#session.createBackup(destinationPath, recoveryPassphrase));
  }

  async restoreBackup(sourcePath: string, backupPassphrase: string): Promise<RestoreResult> {
    return this.#runExclusive(async () => {
      const result = await this.#session.restoreBackup(
        sourcePath,
        backupPassphrase,
        this.#session.state.revision,
      );
      this.#engineHolder.current = new CheckPrinterEngine(result.state);
      return structuredClone(result);
    });
  }

  async close(): Promise<void> {
    await this.#operationTail;
    await this.#session.close();
  }

  async #persistEntitlementChange(expectedRevision: number): Promise<void> {
    if (this.engine.snapshot().revision !== expectedRevision) {
      await this.#session.save(this.engine.snapshot(), expectedRevision);
    }
  }

  async #runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#operationTail;
    let release!: () => void;
    this.#operationTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }
}

export async function openPreUiApplication(
  options: PreUiHostOptions,
): Promise<PreUiApplication> {
  const services = createWindowsHostServices({
    userDataDirectory: options.userDataDirectory,
    temporaryDirectory: options.temporaryDirectory,
    guardDirectory: options.guardDirectory,
    safeStorage: options.safeStorage,
    BrowserWindow: options.BrowserWindow,
    localize: options.localizePdf,
    confirmOutcome: options.confirmOutcome,
    confirmUnknownLetter: options.confirmUnknownLetter,
  });
  const verifiedAt = (options.now ?? (() => new Date()))().toISOString();
  const session = await services.stateRepository.open({
    kind: "FREE",
    source: "LOCAL_FREE",
    verifiedAt,
  });
  try {
    const engineHolder = { current: new CheckPrinterEngine(session.state) };
    const safeStorage = new ElectronSafeStoragePort(options.safeStorage);
    const caches = createProtectedProductCacheStores(
      services.paths.dataDirectory,
      safeStorage,
    );
    const transport = new OneShotStoreProcessTransport(
      options.bridgeExecutablePath,
      options.partnerCenterIdentity,
    );
    const bridge = new StoreProcessAdapter(transport, {
      identity: options.partnerCenterIdentity,
      hwnd: options.ownerHwnd,
      packaged: options.packaged,
      storeAssociated: options.storeAssociated,
    });
    await bridge.initialize();
    const commerce = new LifetimeEntitlementCoordinator(
      bridge,
      caches.receiptStore,
      caches.priceStore,
      {
        snapshot: () => engineHolder.current.snapshot(),
        setEntitlement: (entitlement) => engineHolder.current.setEntitlement(entitlement),
      },
      { now: options.now },
    );
    return new PreUiApplication({
      services,
      engineHolder,
      commerce,
      catalogs: await loadHostCatalogs(),
      session,
    });
  } catch (error) {
    await session.close();
    throw error;
  }
}
