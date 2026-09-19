const path = require("node:path");
const identityName = process.env.MS_STORE_IDENTITY_NAME || "WorksBienStudiosInc.CheckPrinter.DEVELOPMENT";
const publisher = process.env.MS_STORE_PUBLISHER || "CN=WorksBien Development";
const publisherDisplayName = process.env.MS_STORE_PUBLISHER_DISPLAY_NAME || "WorksBien Studios Inc. (Development)";
const msixArch = process.env.MSIX_ARCH;
const bridgeResource = msixArch ? `resources/store-bridge/${msixArch}` : undefined;

if (process.env.MS_STORE_RELEASE === "1") {
  const missing = ["MS_STORE_IDENTITY_NAME", "MS_STORE_PUBLISHER", "MS_STORE_PUBLISHER_DISPLAY_NAME"].filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Store release packaging requires exact Partner Center values: ${missing.join(", ")}`);
  if (/DEVELOPMENT|WorksBien Development/.test(`${identityName}|${publisher}|${publisherDisplayName}`)) {
    throw new Error("Store release packaging refuses development identity values.");
  }
}

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
module.exports = {
  packagerConfig: {
    name: "Check-Printer-Check-Writer",
    executableName: "CheckPrinterCheckWriter",
    asar: true,
    extraResource: bridgeResource ? [bridgeResource] : [],
    overwrite: true,
    ignore: [
      /^\/test($|\/)/,
      /^\/packaging($|\/)/,
      /^\/resources($|\/)/,
      /^\/out($|\/)/,
      /^\/src($|\/)/,
      /^\/tsconfig\.json$/
    ]
  },
  makers: [{
    name: "@electron-forge/maker-msix",
    config: {
      sign: false,
      createPri: true,
      logLevel: "warn",
      appManifest: msixArch ? path.resolve(__dirname, `../resources/msix/${msixArch}/AppxManifest.xml`) : undefined,
      manifestVariables: {
        packageIdentity: identityName,
        publisher,
        publisherDisplayName,
        packageDisplayName: "Check Printer & Check Writer",
        packageDescription: "Create, verify, save and print US and Canadian cheques locally.",
        packageBackgroundColor: "#FFFFFF",
        appDisplayName: "Check Printer & Check Writer",
        appExecutable: "CheckPrinterCheckWriter.exe",
        packageMinOSVersion: "10.0.19041.0",
        packageMaxOSVersionTested: "10.0.26100.0"
      }
    }
  }]
};
