import { EncryptedStateStore } from "../../../src/persistence.ts";
import type { PdfLocalizer } from "../../../src/pdf-renderer-core.ts";
import { AtomicPdfFileWriter } from "./atomic-file.ts";
import type { AppPaths, PrintOutcomeConfirmer, UnknownLetterCapabilityConfirmer } from "./contracts.ts";
import { ElectronNativePrintTransport, ElectronSafeStoragePort, type ElectronBrowserWindowConstructor, type ElectronSafeStorageLike } from "./electron-adapters.ts";
import { createAppPaths } from "./paths.ts";
import { WindowsPdfPrintPlatform } from "./print-platform.ts";
import { WindowsSecureSecretStore } from "./secure-secret-store.ts";
import { WindowsStateRepository } from "./state-repository.ts";

export interface WindowsHostServices {
  readonly paths: AppPaths;
  readonly stateRepository: WindowsStateRepository;
  readonly printPlatform: WindowsPdfPrintPlatform;
}

/** Composition root for the future UI; domain behavior remains in the locked engine. */
export function createWindowsHostServices(options: {
  userDataDirectory: string;
  temporaryDirectory: string;
  guardDirectory?: string;
  safeStorage: ElectronSafeStorageLike;
  BrowserWindow: ElectronBrowserWindowConstructor;
  localize: PdfLocalizer;
  confirmOutcome: PrintOutcomeConfirmer;
  confirmUnknownLetter: UnknownLetterCapabilityConfirmer;
}): WindowsHostServices {
  const paths = createAppPaths(options.userDataDirectory, options.temporaryDirectory, options.guardDirectory);
  const safeStorage = new ElectronSafeStoragePort(options.safeStorage);
  const secretStore = new WindowsSecureSecretStore(paths.secureSecretFile, safeStorage);
  const stateStore = new EncryptedStateStore({ guardDirectory: paths.guardDirectory });
  const transport = new ElectronNativePrintTransport(options.BrowserWindow, paths.temporaryDirectory);
  return {
    paths,
    stateRepository: new WindowsStateRepository(paths, secretStore, stateStore),
    printPlatform: new WindowsPdfPrintPlatform({
      transport,
      fileWriter: new AtomicPdfFileWriter(),
      confirmOutcome: options.confirmOutcome,
      confirmUnknownLetter: options.confirmUnknownLetter,
      localize: options.localize
    })
  };
}
