import { contextBridge, ipcRenderer } from "electron";
import type { WorksBienDesktopBridge, UiActionRequest, UiActionResponse, UiEnvelope } from "../ui/ipc-contract.ts";
import type { UiCatalogBundle } from "../ui/i18n.ts";

const bridge: WorksBienDesktopBridge = Object.freeze({
  platform: "win32" as const,
  getVersion: () => ipcRenderer.invoke("app:get-version") as Promise<string>,
  getUiCatalogs: () => ipcRenderer.invoke("app:get-ui-catalogs") as Promise<UiCatalogBundle>,
  signalReady: () => ipcRenderer.invoke("app:renderer-ready") as Promise<void>,
  initializeUi: () => ipcRenderer.invoke("ui:initialize") as Promise<UiEnvelope>,
  performUiAction: (request: UiActionRequest) => ipcRenderer.invoke("ui:action", request) as Promise<UiActionResponse>,
});

contextBridge.exposeInMainWorld("worksbienHost", bridge);
