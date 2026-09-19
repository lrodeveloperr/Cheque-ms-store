import assert from "node:assert/strict";
import test from "node:test";
import type { SingleInstanceAppPort } from "../../src/platform/contracts.ts";
import { SingleInstanceCoordinator } from "../../src/platform/single-instance.ts";

class FakeApp implements SingleInstanceAppPort {
  primary = true;
  quitCalls = 0;
  releaseCalls = 0;
  listener?: () => void;
  requestSingleInstanceLock(): boolean { return this.primary; }
  releaseSingleInstanceLock(): void { this.releaseCalls += 1; }
  quit(): void { this.quitCalls += 1; }
  onSecondInstance(listener: () => void): void { this.listener = listener; }
}

test("primary process owns one lease and receives second-instance activation", () => {
  const app = new FakeApp();
  let activations = 0;
  const coordinator = new SingleInstanceCoordinator(app);
  const lease = coordinator.acquire(() => { activations += 1; });
  assert.equal(lease.isPrimary, true);
  app.listener?.();
  assert.equal(activations, 1);
  lease.release();
  lease.release();
  assert.equal(app.releaseCalls, 1);
});

test("secondary process exits without claiming a lease", () => {
  const app = new FakeApp();
  app.primary = false;
  const lease = new SingleInstanceCoordinator(app).acquire(() => undefined);
  assert.equal(lease.isPrimary, false);
  assert.equal(app.quitCalls, 1);
  assert.equal(app.listener, undefined);
});
