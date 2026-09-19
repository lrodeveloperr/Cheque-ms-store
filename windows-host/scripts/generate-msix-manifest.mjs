import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arch = process.env.MSIX_ARCH;
if (arch !== "x64" && arch !== "arm64") throw new Error("MSIX_ARCH must be x64 or arm64.");

const release = process.env.MS_STORE_RELEASE === "1";
const identity = process.env.MS_STORE_IDENTITY_NAME || "WorksBienStudiosInc.CheckPrinter.DEVELOPMENT";
const publisher = process.env.MS_STORE_PUBLISHER || "CN=WorksBien Development";
const publisherDisplayName = process.env.MS_STORE_PUBLISHER_DISPLAY_NAME || "WorksBien Studios Inc. (Development)";
if (release && (!process.env.MS_STORE_IDENTITY_NAME || !process.env.MS_STORE_PUBLISHER || !process.env.MS_STORE_PUBLISHER_DISPLAY_NAME)) {
  throw new Error("Release manifest generation requires exact Partner Center identity values.");
}
if (release && /DEVELOPMENT|WorksBien Development/u.test(`${identity}|${publisher}|${publisherDisplayName}`)) {
  throw new Error("Release manifest generation refuses development identity values.");
}

const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const parts = String(packageJson.version).split(".");
if (parts.length !== 3 || parts.some((part) => !/^\d+$/u.test(part))) throw new Error("Host version must be numeric semver.");
const version = `${parts.join(".")}.0`;
const escapeXml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll('"', "&quot;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

let manifest = await readFile(resolve(root, "packaging", "Package.appxmanifest.template.xml"), "utf8");
const replacements = {
  "${MS_STORE_IDENTITY_NAME}": escapeXml(identity),
  "${MS_STORE_PUBLISHER}": escapeXml(publisher),
  "${MS_STORE_PUBLISHER_DISPLAY_NAME}": escapeXml(publisherDisplayName),
  "${PACKAGE_VERSION}": version,
  "${TARGET_ARCH}": arch,
};
for (const [token, value] of Object.entries(replacements)) manifest = manifest.replaceAll(token, value);
if (/\$\{[A-Z0-9_]+\}/u.test(manifest)) throw new Error("The MSIX manifest still contains unresolved variables.");

const destination = resolve(root, "resources", "msix", arch, "AppxManifest.xml");
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, manifest, "utf8");
