import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { UiSessionState, UiStateStore } from "../ui/app-model.ts";

function isSession(value: unknown): value is UiSessionState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<UiSessionState>;
  return candidate.version === 1
    && typeof candidate.route === "string"
    && typeof candidate.locale === "string"
    && (candidate.startSlot === 0 || candidate.startSlot === 1 || candidate.startSlot === 2)
    && Boolean(candidate.onboarding && typeof candidate.onboarding === "object")
    && Boolean(candidate.registerQuery && typeof candidate.registerQuery === "object");
}

/** Stores non-sensitive UI continuity separately from the encrypted cheque ledger. */
export class FileUiStateStore implements UiStateStore {
  readonly #path: string;

  constructor(path: string) {
    this.#path = path;
  }

  async load(): Promise<UiSessionState | undefined> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.#path, "utf8"));
      return isSession(parsed) ? structuredClone(parsed) : undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      return undefined;
    }
  }

  async save(value: UiSessionState): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    const temporaryPath = `${this.#path}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, this.#path);
  }
}
