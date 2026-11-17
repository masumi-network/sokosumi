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
  emitCoreError,
  emitCoreWarning,
  logCoreWarning,
  recordCoreWarning,
  runAsBackgroundWork,
  tryUseLogger,
} from "@/lib/evlog";
import {
  MAX_REDACTION_DEPTH,
  REDACTED_SECRET,
  REDACTED_TOO_DEEP,
} from "@/lib/secret-redaction";
import {
  causeMessage,
  coreLogEvents,
  expectCoreLog,
  takeCoreLogFailures,
} from "./core-log";

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

  it("emitCoreWarning and emitCoreError each emit one standalone event with their context", () => {
    const warnings = expectCoreLog("warn", "Skipped a malformed row");
    const errors = expectCoreLog("error", "Could not save a row");

    emitCoreWarning(
      { operation: "example_sync", row: { id: "row-1" } },
      { message: "Skipped a malformed row", why: "Its date is empty" },
    );
    emitCoreError(
      { operation: "example_sync", row: { id: "row-2" } },
      {
        message: "Could not save a row",
        why: "The database timed out",
        fix: "The next sync retries it",
        cause: "a rejected string, not an Error",
      },
    );

    expect(coreLogEvents()).toHaveLength(2);
    expect(warnings[0]).toMatchObject({ why: "Its date is empty" });
    expect(warnings[0]?.event).toMatchObject({ row: { id: "row-1" } });
    expect(errors[0]).toMatchObject({
      why: "The database timed out",
      fix: "The next sync retries it",
    });
    expect(errors[0]?.event).toMatchObject({ row: { id: "row-2" } });
  });
});

describe("recordCoreWarning", () => {
  it("lands on the request's event while it is live, and on its own event once the request has emitted", async () => {
    const warnings = expectCoreLog("warn", "Skipped a stale row", 2);
    const app = createApp();
    const responded = Promise.withResolvers<void>();
    let afterResponse: Promise<void> | undefined;
    app.get("/rows", (c) => {
      recordCoreWarning(
        { operation: "row_cleanup", row: { id: "row-1" } },
        { message: "Skipped a stale row", why: "Before the response" },
      );
      // Continues in this request's async context, after its event emitted.
      afterResponse = responded.promise.then(() =>
        recordCoreWarning(
          { operation: "row_cleanup", row: { id: "row-2" } },
          { message: "Skipped a stale row", why: "After the response" },
        ),
      );
      return c.json({ ok: true });
    });

    await app.request("http://localhost/rows");
    responded.resolve();
    await afterResponse;

    expect(warnings.map((warning) => warning.why)).toEqual([
      "Before the response",
      "After the response",
    ]);
    expect(warnings[0]?.event).toMatchObject({
      path: "/rows",
      row: { id: "row-1" },
    });
    expect(warnings[0]?.event.operation).toBeUndefined();
    expect(warnings[1]?.event).toMatchObject({
      operation: "row_cleanup",
      row: { id: "row-2" },
    });
    expect(warnings[1]?.event.path).toBeUndefined();
  });

  it("emits its own event for known background work, even while the request is live", async () => {
    const warnings = expectCoreLog("warn", "Skipped a stale row");
    const app = createApp();
    app.get("/sync/rows", (c) => {
      runAsBackgroundWork(() =>
        recordCoreWarning(
          { operation: "row_cleanup" },
          { message: "Skipped a stale row" },
        ),
      );
      return c.json({ ok: true });
    });

    await app.request("http://localhost/sync/rows");

    expect(warnings[0]?.event).toMatchObject({ operation: "row_cleanup" });
    expect(warnings[0]?.event.path).toBeUndefined();
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

  it("redacts the provider text that a warning or error keeps under cause", () => {
    const secret = process.env.OPENROUTER_CHAT_API_KEY ?? "";
    const warnings = expectCoreLog("warn", "Skipped a provider step");
    const errors = expectCoreLog("error", "Could not reach the provider");
    const providerText = `The provider echoed ${secret} for person@example.com`;

    emitCoreWarning(
      { operation: "redaction_test" },
      {
        message: "Skipped a provider step",
        why: "The provider refused the step",
        cause: new Error(providerText),
      },
    );
    emitCoreError(
      { operation: "redaction_test" },
      {
        message: "Could not reach the provider",
        why: "The provider did not answer",
        cause: providerText,
      },
    );

    for (const entry of [warnings[0], errors[0]]) {
      expect(causeMessage(entry?.cause)).toContain(REDACTED_SECRET);
      const drained = JSON.stringify(entry?.event);
      expect(drained).not.toContain(secret);
      expect(drained).not.toContain("person@example.com");
    }
  });

  it("keeps valid UUIDs whole in id-named fields, prefixed ones and arrays included", () => {
    const digits = "01960001-0001-7001-8001-000000000001";
    const hex = "019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a7b";
    // Apple clients send `UUID().uuidString`, which is upper case.
    const upper = "AB12CDEF-1234-5678-9ABC-DEF012345678";

    const log = createCoreLogger({
      task: { id: digits, workspaceId: hex, clientId: upper },
      taskId: digits,
      taskIds: [digits, hex],
      external_id: `task_${digits}`,
      runId: `${digits}:retry`,
    });
    log.emit();

    expect(coreLogEvents()[0]).toMatchObject({
      task: { id: digits, workspaceId: hex, clientId: upper },
      taskId: digits,
      taskIds: [digits, hex],
      external_id: `task_${digits}`,
      runId: `${digits}:retry`,
    });
  });

  it("masks UUID-shaped card digits outside id fields, and in id fields unless the UUID is RFC 9562-valid", () => {
    // Version nibble 1, variant nibble 1: not a valid UUID, a card number in its shape.
    const cardShaped = "41111111-1111-1111-1111-111111111111";
    const digits = "01960001-0001-7001-8001-000000000001";
    const errors = expectCoreLog("error", "Could not charge");

    const log = createCoreLogger({
      payment: { reference: cardShaped, note: `retry of ${digits}` },
      paymentId: cardShaped,
    });
    log.error(createError({ message: `Could not charge ${cardShaped}` }));
    log.emit();

    expect(errors[0]?.message).toBe("Could not charge ****1111-****1111");
    expect(errors[0]?.event).toMatchObject({
      payment: {
        reference: "****1111-****1111",
        note: "retry of ****7001-****0001",
      },
      paymentId: "****1111-****1111",
    });
  });

  it("masks a bearer token or an email that contains a UUID, and a match crossing its edge, in id fields and id arrays too", () => {
    const uuid = "01960001-0001-7001-8001-000000000001";
    const bearer = `Bearer ${uuid}`;
    const email = `alice+${uuid}@example.com`;

    const log = createCoreLogger({
      requestId: bearer,
      taskId: email,
      taskIds: [bearer, email],
      // A card match that starts before the UUID and runs into it.
      sourceId: `4111 ${uuid}`,
    });
    log.emit();

    expect(coreLogEvents()[0]).toMatchObject({
      requestId: "Bearer ***",
      taskId: "a***@***.com",
      taskIds: ["Bearer ***", "a***@***.com"],
      sourceId: "****0001-7001-8001-000000000001",
    });
  });

  it.each([
    ["a bearer token", "Bearer 01960001-0001-7001-8001-000000000001"],
    ["an email", "alice+01960001-0001-7001-8001-000000000001@example.com"],
  ])("never logs %s sent as X-Request-Id", async (_kind, header) => {
    const app = createApp();
    app.get("/v1/example", (c) => c.json({ ok: true }));

    await app.request("http://localhost/v1/example", {
      headers: { "X-Request-Id": header },
    });

    const event = coreLogEvents().find((e) => e.path === "/v1/example");
    // Hono's requestId() replaces a header with characters outside [\w-=].
    expect(event?.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(JSON.stringify(event)).not.toContain(
      "01960001-0001-7001-8001-000000000001",
    );
  });

  it("masks bigint values like strings: a card number and a numeric env secret, nested and in arrays", () => {
    const secret = BigInt(process.env.CORE_LOG_TEST_NUMERIC_SECRET ?? "");

    const log = createCoreLogger({
      card: 4111111111111111n,
      payment: { card: 4111111111111111n, cards: [4242424242424242n] },
      upstream: { echoed: secret, values: [secret] },
    });
    log.emit();

    expect(coreLogEvents()[0]).toMatchObject({
      card: "****1111",
      payment: { card: "****1111", cards: ["****4242"] },
      upstream: { echoed: REDACTED_SECRET, values: [REDACTED_SECRET] },
    });
  });

  it("keeps a large id value whole in linear time", () => {
    // 150,000 all-digit UUIDs: two card matches inside each. A per-match scan
    // of every UUID span takes far longer than the default test timeout here.
    const uuids = Array.from(
      { length: 150_000 },
      (_, index) =>
        `01960001-0001-7001-8001-${String(index).padStart(12, "0")}`,
    ).join(" ");

    const log = createCoreLogger({ relatedIds: uuids });
    log.emit();

    expect(coreLogEvents()[0]?.relatedIds).toBe(uuids);
  });

  it("masks in evlog's order, so a phone-shaped plus address is masked as an email", () => {
    const log = createCoreLogger({ contact: "alice+491234567890@example.com" });
    log.emit();

    expect(coreLogEvents()[0]?.contact).toBe("a***@***.com");
  });

  it("masks card and phone numbers, IBANs, emails, IPs, tokens and env secrets", () => {
    const secret = process.env.OPENROUTER_CHAT_API_KEY ?? "";
    expect(secret.length).toBeGreaterThanOrEqual(16);
    const uuid = "01960001-0001-7001-8001-000000000001";
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const errors = expectCoreLog("error", "Payment failed");

    const log = createCoreLogger({
      paymentId: uuid,
      payment: {
        card: "4111111111111111",
        spacedCard: "4111 1111 1111 1111",
        dashedCard: "4111-1111-1111-1111",
        phone: "+49 30 12345678",
        iban: "DE89 3704 0044 0532 0130 00",
        email: "person@example.com",
        ip: "203.0.113.42",
        authorization: `Bearer ${uuid}`,
        idToken: uuid,
        jwt,
        echoed: `echoed ${secret}`,
      },
    });
    log.error(
      createError({
        message: "Payment failed on 5555-5555-5555-4444 for +44 20 7946 0958",
      }),
    );
    log.emit();

    expect(errors[0]?.message).toBe(
      "Payment failed on ****4444 for +44******58",
    );
    expect(errors[0]?.event.paymentId).toBe(uuid);
    expect(errors[0]?.event.payment).toEqual({
      card: "****1111",
      spacedCard: "****1111",
      dashedCard: "****1111",
      phone: "+49******78",
      iban: "DE89****000",
      email: "p***@***.com",
      ip: "***.***.***.42",
      authorization: "Bearer ***",
      idToken: "[REDACTED]",
      jwt: "eyJ***.***",
      echoed: `echoed ${REDACTED_SECRET}`,
    });
  });

  it("masks inside nested objects, arrays, error causes and requestLogs", () => {
    const card = "4111111111111111";
    const errors = expectCoreLog("error", "Card declined");

    const log = createCoreLogger({
      nested: { billing: { card } },
      cards: [card],
    });
    log.info(`charging ${card}`);
    log.error(
      createError({
        message: "Card declined",
        cause: new Error(`card ${card}`),
      }),
    );
    log.emit();

    const event = errors[0]?.event;
    expect(event?.nested).toEqual({ billing: { card: "****1111" } });
    expect(event?.cards).toEqual(["****1111"]);
    expect(causeMessage(errors[0]?.cause)).toBe("card ****1111");
    expect(event?.requestLogs).toEqual([
      expect.objectContaining({ message: "charging ****1111" }),
    ]);
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
