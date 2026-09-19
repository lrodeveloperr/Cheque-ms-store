import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import type { AppPaths } from "./contracts.ts";

export function createAppPaths(userDataDirectory: string, temporaryDirectory: string, guardRootDirectory?: string): AppPaths {
  if (!isAbsolute(userDataDirectory) || !isAbsolute(temporaryDirectory)) {
    throw new Error("Windows host directories must be absolute paths.");
  }
  const dataDirectory = normalize(resolve(userDataDirectory));
  const defaultGuardRoot =
    process.platform === "win32" && process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, "WorksBien", "CheckPrinter", "guards")
      : join(dirname(dataDirectory), "WorksBien-CheckPrinter-Guards");
  const guardRoot = normalize(resolve(guardRootDirectory ?? defaultGuardRoot));
  const foldedData = dataDirectory.toLocaleLowerCase("en-US");
  const foldedGuard = guardRoot.toLocaleLowerCase("en-US");
  if (foldedGuard === foldedData || foldedGuard.startsWith(`${foldedData}${sep}`)) {
    throw new Error("Recovery guards must be stored outside the restorable state directory.");
  }
  return Object.freeze({
    dataDirectory,
    stateFile: join(dataDirectory, "worksbien-check-printer.wbc"),
    secureSecretFile: join(dataDirectory, "storage-key.dpapi"),
    guardDirectory: guardRoot,
    temporaryDirectory: normalize(resolve(temporaryDirectory))
  });
}

export function requireBackupPath(path: string): string {
  if (!isAbsolute(path)) throw new Error("A backup path must be absolute.");
  if (!path.toLocaleLowerCase("en-US").endsWith(".wbc")) throw new Error("Backups must use the .wbc extension.");
  return normalize(resolve(path));
}

export function requirePdfPath(path: string): string {
  if (!isAbsolute(path)) throw new Error("A PDF destination must be absolute.");
  if (!path.toLocaleLowerCase("en-US").endsWith(".pdf")) throw new Error("PDF exports must use the .pdf extension.");
  return normalize(resolve(path));
}
