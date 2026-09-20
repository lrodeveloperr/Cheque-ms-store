const fs = require("node:fs");
const path = require("node:path");
const release = process.env.MS_STORE_RELEASE === "1";
const productionConfig = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../src/product/partner-center.production.json"), "utf8"));
function releaseValue(environmentName, configName) {
  const configured = String(productionConfig[configName] || "");
  const override = process.env[environmentName];
  if (release && override && override !== configured) {
    throw new Error(`${environmentName} does not match the canonical Partner Center configuration.`);
  }
  return release ? configured : override;
}
const identityName = releaseValue("MS_STORE_IDENTITY_NAME", "packageIdentityName") || "WorksBienStudiosInc.CheckPrinter.DEVELOPMENT";
const publisher = releaseValue("MS_STORE_PUBLISHER", "publisherSubject") || "CN=WorksBien Development";
const publisherDisplayName = releaseValue("MS_STORE_PUBLISHER_DISPLAY_NAME", "publisherDisplayName") || "WorksBien Studios Inc. (Development)";
const msixArch = process.env.MSIX_ARCH;
const bridgeResource = msixArch ? `resources/store-bridge/${msixArch}` : undefined;

function discoverWindowsKitVersion(arch) {
  if (process.env.WINDOWS_KIT_VERSION) return process.env.WINDOWS_KIT_VERSION;
  if (process.platform !== "win32" || !arch) return undefined;
  const programFiles = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const kitBin = path.join(programFiles, "Windows Kits", "10", "bin");
  if (!fs.existsSync(kitBin)) return undefined;
  const candidates = fs.readdirSync(kitBin, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+\.\d+\.\d+\.\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .filter((version) => fs.existsSync(path.join(kitBin, version, arch, "makeappx.exe")))
    .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
  return candidates.at(-1);
}

const windowsKitVersion = discoverWindowsKitVersion(msixArch);

if (release) {
  if (/DEVELOPMENT|WorksBien Development/.test(`${identityName}|${publisher}|${publisherDisplayName}`)) {
    throw new Error("Store release packaging refuses development identity values.");
  }
  if (!productionConfig.packageFamilyName || !/^[A-Z0-9]{12}$/i.test(productionConfig.appStoreId) || !/^[A-Z0-9]{12}$/i.test(productionConfig.lifetimeAddOnStoreId)) {
    throw new Error("The canonical Partner Center configuration is incomplete.");
  }
}

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
module.exports = {
  packagerConfig: {
    name: "Check-Printer-Check-Writer",
    executableName: "CheckPrinterCheckWriter",
    icon: path.resolve(__dirname, "../resources/app-icon.ico"),
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
      packageAssets: path.resolve(__dirname, "../resources/msix-assets"),
      windowsKitVersion,
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
