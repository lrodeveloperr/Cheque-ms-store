export class RuntimeStartup<T> {
  readonly #onFailure: (error: unknown) => void;
  #runtimePromise: Promise<T> | undefined;

  constructor(onFailure: (error: unknown) => void) {
    this.#onFailure = onFailure;
  }

  start(factory: () => Promise<T>): Promise<T> {
    if (this.#runtimePromise) return this.#runtimePromise;

    // Schedule the factory through an already-created promise so the rejection
    // observer is attached before either a synchronous throw or asynchronous
    // rejection can become unhandled.
    const pending = Promise.resolve().then(factory);
    this.#runtimePromise = pending;
    void pending.catch((error: unknown) => {
      try {
        this.#onFailure(error);
      } catch {
        // Failure reporting must never create a second unhandled rejection.
      }
    });
    return pending;
  }

  async require(): Promise<T> {
    if (!this.#runtimePromise) {
      throw new Error("The application runtime has not started.");
    }
    return this.#runtimePromise;
  }
}
