import { Hono } from "hono";
import type { RequestIdVariables } from "hono/request-id";
import { requestId } from "hono/request-id";
import { describe, expect, it } from "vitest";

import {
  coreEvlogMiddleware,
  createCoreLogger,
  logCoreWarning,
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
