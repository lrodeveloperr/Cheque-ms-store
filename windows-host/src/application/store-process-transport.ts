import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";
import type { JsonLineStoreTransport } from "../product/store-process-adapter.ts";
import type { PartnerCenterIdentity } from "../product/product-identity.ts";

const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_DIAGNOSTIC_BYTES = 16 * 1024;

export class OneShotStoreProcessTransport implements JsonLineStoreTransport {
  readonly #executablePath: string;
  readonly #identity: PartnerCenterIdentity;

  constructor(executablePath: string, identity: PartnerCenterIdentity) {
    if (!isAbsolute(executablePath) || !executablePath.toLowerCase().endsWith(".exe")) {
      throw new Error("The Store bridge path must be an absolute .exe path.");
    }
    this.#executablePath = executablePath;
    this.#identity = structuredClone(identity);
  }

  request(value: {
    action: "readiness" | "getProduct" | "getLicense" | "purchase";
    storeId: string;
    hwnd: number;
  }): Promise<unknown> {
    if (value.storeId !== this.#identity.lifetimeAddOnStoreId) {
      return Promise.reject(new Error("The requested Store ID is not the configured Lifetime add-on."));
    }
    return new Promise((resolve, reject) => {
      const child = spawn(this.#executablePath, [], {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          WORKSBIEN_LIFETIME_STORE_ID: this.#identity.lifetimeAddOnStoreId,
          WORKSBIEN_APP_STORE_ID: this.#identity.appStoreId,
          WORKSBIEN_PACKAGE_IDENTITY_NAME: this.#identity.packageIdentityName,
          WORKSBIEN_PACKAGE_FAMILY_NAME: this.#identity.packageFamilyName,
          WORKSBIEN_PUBLISHER_SUBJECT: this.#identity.publisherSubject,
        },
      });
      const timeoutMs = value.action === "purchase" ? 5 * 60_000 : 30_000;
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("The Microsoft Store bridge timed out."));
      }, timeoutMs);
      timer.unref();

      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (error?: Error, result?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(result);
      };

      child.once("error", (error) => finish(error));
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
        if (Buffer.byteLength(stdout, "utf8") > MAX_RESPONSE_BYTES) {
          child.kill();
          finish(new Error("The Microsoft Store bridge response was too large."));
        }
      });
      child.stderr.on("data", (chunk: string) => {
        if (Buffer.byteLength(stderr, "utf8") < MAX_DIAGNOSTIC_BYTES) stderr += chunk;
      });
      child.once("close", (code) => {
        if (settled) return;
        const lines = stdout.split(/\r?\n/u).filter((line) => line.trim().length > 0);
        if (lines.length !== 1) {
          finish(new Error("The Microsoft Store bridge returned an invalid response count."));
          return;
        }
        try {
          const parsed: unknown = JSON.parse(lines[0]!);
          if (code !== 0 && !(parsed && typeof parsed === "object")) {
            finish(new Error(`The Microsoft Store bridge exited with code ${code ?? "unknown"}.`));
            return;
          }
          finish(undefined, parsed);
        } catch {
          finish(new Error(`The Microsoft Store bridge returned invalid JSON${stderr ? "." : ""}`));
        }
      });

      child.stdin.end(`${JSON.stringify(value)}\n`, "utf8");
    });
  }
}
