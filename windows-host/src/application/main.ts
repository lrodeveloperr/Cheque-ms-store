import { app } from "electron";

// This is the pre-UI Windows process entry. It proves the packaged host starts,
// enforces one OS process, and remains ready for the future BrowserWindow shell.
// Product services are opened only after the UI supplies an owning HWND and the
// authoritative Partner Center identity.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // The UI phase will focus the existing window here.
  });
  void app.whenReady().then(() => {
    app.setAppUserModelId("WorksBienStudios.CheckPrinterCheckWriter");
  }).catch(() => app.exit(1));
}
