import { Hono } from "hono";
import type { RequestIdVariables } from "hono/request-id";
import { requestId } from "hono/request-id";
import { describe, expect, it } from "vitest";

import {
  coreEvlogMiddleware,
  createCoreLogger,
  emitCoreWarning,
  logCoreWarning,
  recordCoreError,
  runAsBackgroundWork,
  tryUseLiveLogger,
} from "@/lib/evlog";
import { coreLogEvents, expectCoreLog } from "@/test/core-log";

/** How Core code that may run in a request logs: the live event, else its own. */
function warnLiveOrStandalone(message: string) {
  const live = tryUseLiveLogger();
  const log = live ?? createCoreLogger({ operation: "background_example" });
  logCoreWarning(log, { message, why: "The example failed" });
  if (!live) log.emit();
}

function createApp() {
  const app = new Hono<{ Variables: RequestIdVariables }>();
  app.use(requestId());
  app.use(coreEvlogMiddleware());
  return app;
}

describe("runAsBackgroundWork", () => {
  it("keeps work started in waitUntil off the request's event while that event is still open", async () => {
    const warnings = expectCoreLog("warn", "Background work failed");
    const app = createApp();
    let insideRequest: unknown;
    app.get("/v1/example", async (c) => {
      // Started and failing before the response is sent.
      await runAsBackgroundWork(async () =>
        warnLiveOrStandalone("Background work failed"),
      );
      insideRequest = tryUseLiveLogger();
      return c.json({ ok: true });
    });

    expect((await app.request("http://localhost/v1/example")).status).toBe(200);

    expect(insideRequest).not.toBeNull();
    expect(coreLogEvents()).toHaveLength(2);
    expect(warnings[0]?.event).toMatchObject({
      operation: "background_example",
    });
    expect(warnings[0]?.event.path).toBeUndefined();
  });

  it("logs a standalone event when the work fails after the response", async () => {
    const warnings = expectCoreLog("warn", "Background work failed");
    const app = createApp();
    let release: () => void = () => {};
    let afterResponse: Promise<void> | undefined;
    app.get("/v1/example", (c) => {
      afterResponse = runAsBackgroundWork(async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        warnLiveOrStandalone("Background work failed");
      });
      return c.json({ ok: true });
    });

    await app.request("http://localhost/v1/example");
    release();
    await afterResponse;

    expect(coreLogEvents()).toHaveLength(2);
    expect(warnings[0]?.event).toMatchObject({
      operation: "background_example",
    });
  });
});

describe("a sync run's id", () => {
  const RUN_A = "01960001-0001-7001-8001-00000000000a";
  const RUN_B = "01960001-0001-7001-8001-00000000000b";

  function failInService(message: string) {
    recordCoreError(
      { operation: "service_example" },
      { message, why: "The example failed" },
    );
  }

  it("is on a service event emitted inside the run", async () => {
    const errors = expectCoreLog("error", "Service failed");

    await runAsBackgroundWork(async () => failInService("Service failed"), {
      syncRunId: RUN_A,
    });

    expect(errors[0]?.event).toMatchObject({
      operation: "service_example",
      syncRunId: RUN_A,
    });
  });

  it("stays with its own run when two runs overlap", async () => {
    const errors = expectCoreLog("error", "Service failed in run", 2);
    let releaseA: () => void = () => {};
    const runA = runAsBackgroundWork(
      async () => {
        await new Promise<void>((resolve) => {
          releaseA = resolve;
        });
        failInService("Service failed in run A");
      },
      { syncRunId: RUN_A },
    );
    // Run B starts and ends while run A is still waiting.
    await runAsBackgroundWork(
      async () => failInService("Service failed in run B"),
      { syncRunId: RUN_B },
    );
    releaseA();
    await runA;

    expect(errors.map((entry) => entry.event.syncRunId)).toEqual([
      RUN_B,
      RUN_A,
    ]);
  });

  it("is kept by background work the run starts", async () => {
    const warnings = expectCoreLog("warn", "Nested work failed");

    await runAsBackgroundWork(
      () =>
        runAsBackgroundWork(async () =>
          emitCoreWarning(
            { operation: "nested_example" },
            { message: "Nested work failed", why: "The example failed" },
          ),
        ),
      { syncRunId: RUN_A },
    );

    expect(warnings[0]?.event).toMatchObject({ syncRunId: RUN_A });
  });

  it("is kept by detached work the run starts, after the run ends", async () => {
    const warnings = expectCoreLog("warn", "Detached work failed");
    let release: () => void = () => {};
    let detached: Promise<void> | undefined;

    await runAsBackgroundWork(
      async () => {
        // Started without await, as `waitUntil` work is.
        detached = new Promise<void>((resolve) => {
          release = resolve;
        }).then(() =>
          emitCoreWarning(
            { operation: "detached_example" },
            { message: "Detached work failed", why: "The example failed" },
          ),
        );
      },
      { syncRunId: RUN_A },
    );
    release();
    await detached;

    expect(warnings[0]?.event).toMatchObject({ syncRunId: RUN_A });
  });

  it("is on no event after the run ends", async () => {
    const errors = expectCoreLog("error", "Service failed", 4);
    await runAsBackgroundWork(
      async () => failInService("Service failed in run"),
      {
        syncRunId: RUN_A,
      },
    );
    const app = createApp();
    app.get("/v1/example", (c) => {
      failInService("Service failed in a later request");
      return c.json({ ok: true });
    });

    failInService("Service failed outside");
    await app.request("http://localhost/v1/example");
    await runAsBackgroundWork(async () =>
      failInService("Service failed in plain background work"),
    );

    expect(errors.map((entry) => entry.event.syncRunId)).toEqual([
      RUN_A,
      undefined,
      undefined,
      undefined,
    ]);
    const request = coreLogEvents().find(
      (event) => event.path === "/v1/example",
    );
    expect(request).toBeDefined();
    expect(request).not.toHaveProperty("syncRunId");
  });
});
