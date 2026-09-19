import { mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { PdfFileWriter } from "./contracts.ts";

export async function atomicWriteBytes(destinationPath: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(destinationPath), { recursive: true });
  const temporaryPath = `${destinationPath}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    await rename(temporaryPath, destinationPath);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export class AtomicPdfFileWriter implements PdfFileWriter {
  writeAtomically(destinationPath: string, bytes: Uint8Array): Promise<void> {
    return atomicWriteBytes(destinationPath, bytes);
  }
}
