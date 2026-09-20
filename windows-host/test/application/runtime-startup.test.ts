import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeStartup } from "../../src/application/runtime-startup.ts";

test("runtime initialization failures are observed and returned to IPC callers", async () => {
  const failure = new Error("fresh-install initialization failed");
  const observed: unknown[] = [];
  const startup = new RuntimeStartup<object>((error) => observed.push(error));

  const started = startup.start(async () => { throw failure; });
  await assert.rejects(started, failure);
  await assert.rejects(startup.require(), failure);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(observed, [failure]);
});

test("runtime initialization starts once and refuses access before startup", async () => {
  const startup = new RuntimeStartup<{ ready: true }>(() => undefined);
  await assert.rejects(startup.require(), /has not started/i);

  let calls = 0;
  const first = startup.start(async () => {
    calls += 1;
    return { ready: true } as const;
  });
  const second = startup.start(async () => {
    calls += 1;
    return { ready: true } as const;
  });

  assert.equal(first, second);
  assert.deepEqual(await startup.require(), { ready: true });
  assert.equal(calls, 1);
});
