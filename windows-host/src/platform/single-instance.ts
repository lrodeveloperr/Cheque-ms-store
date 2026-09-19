import type { SingleInstanceAppPort, SingleInstanceLease } from "./contracts.ts";

export class SingleInstanceCoordinator {
  readonly #app: SingleInstanceAppPort;
  #lease?: SingleInstanceLease;

  constructor(app: SingleInstanceAppPort) { this.#app = app; }

  acquire(onSecondInstance: () => void): SingleInstanceLease {
    if (this.#lease) return this.#lease;
    const isPrimary = this.#app.requestSingleInstanceLock({ product: "Check Printer & Check Writer" });
    if (!isPrimary) {
      this.#app.quit();
      return { isPrimary: false, release: () => undefined };
    }
    this.#app.onSecondInstance(onSecondInstance);
    let released = false;
    this.#lease = {
      isPrimary: true,
      release: () => {
        if (released) return;
        released = true;
        this.#app.releaseSingleInstanceLock();
        this.#lease = undefined;
      }
    };
    return this.#lease;
  }
}
