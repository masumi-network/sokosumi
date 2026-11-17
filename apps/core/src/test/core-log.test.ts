import { expectConsole } from "@sokosumi/utils/test-console";
import { createError } from "evlog";
import { Hono } from "hono";
import type { RequestIdVariables } from "hono/request-id";
import { requestId } from "hono/request-id";
import { describe, expect, it } from "vitest";

import {
  bindCoreRequestContext,
  coreEvlogMiddleware,
  createCoreLogger,
  logCoreWarning,
  tryUseLogger,
} from "@/lib/evlog";
import {
  MAX_REDACTION_DEPTH,
  REDACTED_SECRET,
  REDACTED_TOO_DEEP,
} from "@/lib/secret-redaction";
import { coreLogEvents, expectCoreLog, takeCoreLogFailures } from "./core-log";

function createApp() {
  const app = new Hono<{ Variables: RequestIdVariables }>();
  app.use(requestId());
  app.use(coreEvlogMiddleware());
  app.use(bindCoreRequestContext());
  return app;
}

describe("expectCoreLog", () => {
  it("matches an error by level and message start and hands back why and fix", () => {
    const errors = expectCoreLog("error", "Could not reach");

    const log = createCoreLogger({ operation: "core_log_test" });
    log.error(
      createError({
        message: "Could not reach the test service",
        why: "The service answered 503",
        fix: "Retry once the service is back",
      }),
    );
    log.emit();

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      level: "error",
      message: "Could not reach the test service",
      why: "The service answered 503",
      fix: "Retry once the service is back",
    });
    expect(errors[0]?.event.operation).toBe("core_log_test");
  });

  it("counts each warning on an event separately", () => {
    const warnings = expectCoreLog("warn", "Skipped a row", 2);

    const log = createCoreLogger();
    logCoreWarning(log, { message: "Skipped a row", why: "It had no id" });
    logCoreWarning(log, { message: "Skipped a row", why: "It was archived" });
    log.emit();

    expect(warnings.map((warning) => warning.why)).toEqual([
      "It had no id",
      "It was archived",
    ]);
  });
});

describe("where Core logs go", () => {
  it("inside a request, a warning lands on the request's wide event", async () => {
    const warnings = expectCoreLog("warn", "Ignored an unknown filter");
    const app = createApp();
    app.get("/sync/example", (c) => {
      const log = tryUseLogger();
      if (log) {
        logCoreWarning(
          log,
          {
            message: "Ignored an unknown filter",
            why: "The cron job sent `state=archived`, which this route does not know",
            fix: "Drop the filter from the cron configuration",
          },
          { filter: { state: "archived" } },
        );
      }
      return c.json({ ok: true });
    });

    const response = await app.request("http://localhost/sync/example");

    expect(response.status).toBe(200);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.event).toMatchObject({
      path: "/sync/example",
      requestId: expect.any(String),
      filter: { state: "archived" },
    });
  });

  it("after the response, work emits its own standalone event", async () => {
    const errors = expectCoreLog("error", "Could not send the receipt");
    const app = createApp();
    let afterResponse: Promise<void> | undefined;
    app.post("/v1/orders", (c) => {
      afterResponse = (async () => {
        await Promise.resolve();
        const log = createCoreLogger({ operation: "order_receipt" });
        log.error(
          createError({
            message: "Could not send the receipt",
            why: "The mail provider rejected the sender",
          }),
        );
        log.emit();
      })();
      return c.json({ ok: true });
    });

    await app.request("http://localhost/v1/orders", { method: "POST" });
    await afterResponse;

    expect(errors).toHaveLength(1);
    expect(errors[0]?.event.operation).toBe("order_receipt");
    expect(errors[0]?.event.path).toBeUndefined();
  });

  it("outside any request, background work emits a standalone event", () => {
    const warnings = expectCoreLog("warn", "Started without");

    const log = createCoreLogger({ operation: "startup" });
    logCoreWarning(log, {
      message: "Started without a mail provider",
      why: "RESEND_API_KEY is not set",
      fix: "Set RESEND_API_KEY to send mail",
    });
    log.emit();

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.event.operation).toBe("startup");
  });
});

describe("redaction before the drain", () => {
  it("keeps env secrets, tokens and emails out of the drained event", () => {
    const secret = process.env.OPENROUTER_CHAT_API_KEY ?? "";
    expect(secret.length).toBeGreaterThanOrEqual(16);
    const errors = expectCoreLog("error", "Upstream refused");

    const log = createCoreLogger({
      operation: "redaction_test",
      upstream: { accessToken: "opaque-access-token-value" },
    });
    log.error(
      createError({
        message: "Upstream refused the call for person@example.com",
        why: `It echoed our key ${secret} and Authorization: Bearer abcdefghijklmnop`,
      }),
    );
    log.emit();

    const drained = JSON.stringify(errors[0]?.event);
    expect(drained).not.toContain(secret);
    expect(drained).not.toContain("abcdefghijklmnop");
    expect(drained).not.toContain("opaque-access-token-value");
    expect(drained).not.toContain("person@example.com");
    expect(errors[0]?.why).toContain(REDACTED_SECRET);
  });
});

describe("the drain's contract", () => {
  it("fails on a warning nobody declared, including a plain log.warn", () => {
    const log = createCoreLogger();
    log.warn("Plain warning");
    log.emit();

    expect(takeCoreLogFailures()).toEqual([
      "Undeclared Core log entries:\nwarn: Plain warning",
    ]);
  });

  it("fails on an error nobody declared", () => {
    const log = createCoreLogger();
    log.error(createError({ message: "Surprise failure" }));
    log.emit();

    expect(takeCoreLogFailures()).toEqual([
      "Undeclared Core log entries:\nerror: Surprise failure",
    ]);
  });

  it("counts a plain log.warn and a logCoreWarning once each", () => {
    const warnings = expectCoreLog("warn", "Twice", 2);

    const log = createCoreLogger();
    log.warn("Twice, plain");
    logCoreWarning(log, { message: "Twice, structured", why: "because" });
    log.emit();

    expect(warnings.map((warning) => warning.why)).toEqual([
      undefined,
      "because",
    ]);
  });

  it("fails when an entry comes more often than declared", () => {
    expectCoreLog("error", "Failure", 1);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const log = createCoreLogger();
      log.error(createError({ message: "Failure again" }));
      log.emit();
    }

    expect(takeCoreLogFailures()).toEqual([
      "Expected Core log entries came another number of times:\nerror: Failure (expected 1, got 2)",
    ]);
  });

  it("fails when an entry declared zero times comes", () => {
    expectCoreLog("warn", "Never", 0);

    const log = createCoreLogger();
    log.warn("Never say never");
    log.emit();

    expect(takeCoreLogFailures()).toEqual([
      "Expected Core log entries came another number of times:\nwarn: Never (expected 0, got 1)",
    ]);
  });
});

describe("the drain's records", () => {
  it("keeps every drained event of the test, info events included", () => {
    createCoreLogger({ operation: "info_only" }).emit();

    expect(coreLogEvents()).toHaveLength(1);
    expect(coreLogEvents()[0]).toMatchObject({
      level: "info",
      operation: "info_only",
    });
  });

  it("keeps a structured warning's guidance on its own line when a plain warning shares its message", () => {
    const warnings = expectCoreLog("warn", "Same text", 2);

    const log = createCoreLogger();
    log.warn("Same text");
    logCoreWarning(log, { message: "Same text", why: "structured" });
    log.emit();

    expect(warnings.map((warning) => warning.why)).toEqual([
      undefined,
      "structured",
    ]);
  });
});

describe("emitting an event logging cannot walk", () => {
  it("drains a cyclic event with a cyclic toJSON instead of throwing", () => {
    const errors = expectCoreLog("error", "Cyclic context");
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic.self = cyclic;
    cyclic.toJSON = () => cyclic;

    // evlog cannot clone a function-bearing cycle and says so; the event
    // still goes out, through Core's transform.
    expectConsole("warn", "[cloneForRedaction] Shallow clone used");
    const log = createCoreLogger({ cyclic });
    log.error(createError({ message: "Cyclic context" }));
    expect(() => log.emit()).not.toThrow();

    expect(errors).toHaveLength(1);
    expect(JSON.stringify(errors[0]?.event)).toContain("loop");
  });

  it("drains a deep event cut at the depth limit, so evlog's built-ins never walk deeper", () => {
    // evlog's recursive built-ins and JSON output only ever see what Core's
    // transform hands them: at most MAX_REDACTION_DEPTH levels. Testing at
    // the stack limit itself would depend on the stack left at that moment.
    const errors = expectCoreLog("error", "Deep context");
    const secret = process.env.OPENROUTER_CHAT_API_KEY ?? "";
    let deep: Record<string, unknown> = { body: `echo ${secret}` };
    for (let level = 0; level < 500; level += 1) deep = { next: deep };

    const log = createCoreLogger({ deep });
    log.error(createError({ message: "Deep context" }));
    expect(() => log.emit()).not.toThrow();

    const drained = JSON.stringify(errors[0]?.event);
    expect(drained).not.toContain(secret);
    expect(drained).toContain(REDACTED_TOO_DEEP);
    let levels = 0;
    let node = errors[0]?.event.deep as Record<string, unknown> | string;
    while (typeof node === "object") {
      node = node.next as Record<string, unknown> | string;
      levels += 1;
    }
    expect(levels).toBeLessThan(MAX_REDACTION_DEPTH);
  });

  it("masks an env secret in a nested field and in an error cause", () => {
    const errors = expectCoreLog("error", "Nested secret");
    const secret = process.env.OPENROUTER_CHAT_API_KEY ?? "";
    let nested: Record<string, unknown> = { body: `echo ${secret}` };
    for (let level = 0; level < 10; level += 1) nested = { cause: nested };

    const log = createCoreLogger({ upstream: nested });
    log.error(
      createError({
        message: "Nested secret",
        cause: new Error("outer", {
          cause: new Error(`inner echoed ${secret}`),
        }),
      }),
    );
    log.emit();

    expect(JSON.stringify(errors[0]?.event)).not.toContain(secret);
  });
});
