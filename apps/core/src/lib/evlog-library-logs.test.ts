import { logger as composioSdkLogger } from "@composio/core";
import { Hono } from "hono";
import type { RequestIdVariables } from "hono/request-id";
import { requestId } from "hono/request-id";
import { describe, expect, it, vi } from "vitest";

import { getComposio } from "@/clients/composio.client";
import { auth } from "@/lib/auth";
import { bindCoreRequestContext, coreEvlogMiddleware } from "@/lib/evlog";
import { composioLogger as coreComposioSink } from "@/lib/evlog-library-logs";
import { restoreComposioSdkLoggerAfterFile } from "@/test/composio-sdk-logger";
import { coreLogEvents, expectCoreLog } from "@/test/core-log";

vi.hoisted(() => {
  // `getComposio` builds the client, and with it Core's SDK logger, only
  // when a key is configured. Unstubbed at the end of the file.
  vi.stubEnv("COMPOSIO_API_KEY", "test-composio-api-key");
});

restoreComposioSdkLoggerAfterFile();

function createApp() {
  const app = new Hono<{ Variables: RequestIdVariables }>();
  app.use(requestId());
  app.use(coreEvlogMiddleware());
  app.use(bindCoreRequestContext());
  return app;
}

/** Runs `log` inside a request to `/v1/example` and returns once it is done. */
async function inRequest(log: () => void | Promise<void>) {
  const app = createApp();
  app.get("/v1/example", async (c) => {
    await log();
    return c.json({ ok: true });
  });
  expect((await app.request("http://localhost/v1/example")).status).toBe(200);
}

async function betterAuthLogger() {
  return (await auth.$context).logger;
}

function composioLogger() {
  expect(getComposio()).not.toBeNull();
  return composioSdkLogger;
}

describe("Better Auth's logger", () => {
  it("inside a request, logs onto the request's wide event, tagged with its source", async () => {
    const warnings = expectCoreLog("warn", "Skipped 1 JWKS signing key");
    const log = await betterAuthLogger();

    await inRequest(() => log.warn("Skipped 1 JWKS signing key"));

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.event).toMatchObject({
      path: "/v1/example",
      requestId: expect.any(String),
      libraryLogs: [
        {
          source: "better-auth",
          level: "warn",
          message: "Skipped 1 JWKS signing key",
        },
      ],
    });
  });

  it("outside a request, logs a standalone event tagged with its source", async () => {
    const errors = expectCoreLog("error", "Failed to parse state");
    const log = await betterAuthLogger();

    log.error("Failed to parse state", new Error("state mismatch"));

    expect(errors).toHaveLength(1);
    expect(errors[0]?.event).toMatchObject({
      source: "better-auth",
      error: { cause: { message: "state mismatch" } },
    });
    expect(errors[0]?.event.path).toBeUndefined();
  });

  it("keeps its level at warn, so info and debug stay out of the drain", async () => {
    const log = await betterAuthLogger();

    log.info("Routine Better Auth note");
    log.debug("Better Auth step detail");

    expect(coreLogEvents()).toEqual([]);
  });
});

describe("the Composio SDK's logger", () => {
  it("inside a request, logs onto the request's wide event, tagged with its source", async () => {
    const warnings = expectCoreLog("warn", "Tool schema is missing");
    const log = composioLogger();

    await inRequest(() => log.warn("Tool schema is missing a description"));

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toBe("Tool schema is missing a description");
    expect(warnings[0]?.event).toMatchObject({
      path: "/v1/example",
      libraryLogs: [{ source: "composio", level: "warn" }],
    });
  });

  it("outside a request, logs a standalone event tagged with its source", () => {
    const errors = expectCoreLog("error", "Failed to fetch toolkit");
    const log = composioLogger();

    log.error("Failed to fetch toolkit");

    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe("Failed to fetch toolkit");
    expect(errors[0]?.event.source).toBe("composio");
  });

  it("logs the multiple connected accounts warning, which Core asks for, as info", async () => {
    const log = composioLogger();

    await inRequest(() =>
      log.warn(
        "[Warn:AllowMultiple] Multiple connected accounts found for user sokobot:bot in auth config auth-gmail",
      ),
    );

    const [event] = coreLogEvents();
    expect(coreLogEvents()).toHaveLength(1);
    expect(event).toMatchObject({
      level: "info",
      requestLogs: [
        {
          level: "info",
          message:
            "[Warn:AllowMultiple] Multiple connected accounts found for user sokobot:bot in auth config auth-gmail",
        },
      ],
      libraryLogs: [{ source: "composio", level: "info" }],
    });
  });

  it("keeps every other Composio warning a warning", () => {
    const warnings = expectCoreLog("warn", "[Warn:Deprecated]");
    const log = composioLogger();

    log.warn("[Warn:Deprecated] toolkit versions will be required");

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.event).toMatchObject({
      level: "warn",
      source: "composio",
    });
  });
});

describe("library messages after the request's event was emitted", () => {
  it("land on a standalone event with the request's id instead of being lost", async () => {
    const warnings = expectCoreLog("warn", "Tool schema is missing");
    const log = composioLogger();
    let release: () => void = () => {};
    let afterResponse: Promise<void> | undefined;
    const app = createApp();
    app.get("/v1/example", (c) => {
      // Background work keeps the request's async context after the response.
      afterResponse = new Promise<void>((resolve) => {
        release = resolve;
      }).then(() => log.warn("Tool schema is missing a description"));
      return c.json({ ok: true });
    });

    const response = await app.request("http://localhost/v1/example");
    expect(coreLogEvents()).toHaveLength(1);
    release();
    await afterResponse;

    expect(response.status).toBe(200);
    expect(coreLogEvents()).toHaveLength(2);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.event).toMatchObject({
      source: "composio",
      requestId: coreLogEvents()[0]?.requestId,
    });
    expect(warnings[0]?.event.status).toBeUndefined();
  });
});

describe("what a library message keeps", () => {
  it("drops URL query strings and fragments, which carry OAuth state and tokens", async () => {
    const errors = expectCoreLog("error", "Invalid callbackURL");
    const log = await betterAuthLogger();

    log.error(
      "Invalid callbackURL: https://example.invalid/cb?state=opaque-state&token=opaque-token#opaque-fragment",
      new Error(
        "Rejected /auth/callback/google?code=opaque-code for person@example.com",
      ),
    );

    const drained = JSON.stringify(errors[0]?.event);
    expect(errors[0]?.message).toBe(
      "Invalid callbackURL: https://example.invalid/cb",
    );
    for (const value of [
      "opaque-state",
      "opaque-token",
      "opaque-fragment",
      "opaque-code",
      "person@example.com",
    ]) {
      expect(drained).not.toContain(value);
    }
    expect(drained).toContain("/auth/callback/google");
  });
});

describe("what a library message keeps, at depth and in errors", () => {
  function nested(depth: number, leaf: unknown): unknown {
    return depth === 0 ? leaf : { next: nested(depth - 1, leaf) };
  }

  it.each([9, 17])(
    "keeps a URL's query out of the drain %i levels deep",
    async (depth) => {
      const errors = expectCoreLog("error", "Upstream call failed");
      const log = await betterAuthLogger();

      log.error(
        "Upstream call failed",
        nested(depth, {
          url: "https://example.invalid/cb?state=opaque-secret",
        }),
      );

      expect(JSON.stringify(errors[0]?.event)).not.toContain("opaque-secret");
    },
  );

  it("keeps the punctuation next to a URL", async () => {
    const errors = expectCoreLog("error", "Invalid redirectTo");
    const log = await betterAuthLogger();

    log.error(
      "Invalid redirectTo (https://example.invalid/next?token=opaque-token), rejected.",
    );

    expect(errors[0]?.message).toBe(
      "Invalid redirectTo (https://example.invalid/next), rejected.",
    );
  });

  it("strips a query in linear time, so a hostile callbackURL cannot stall the event loop", async () => {
    const errors = expectCoreLog("error", "Invalid callbackURL");
    const log = await betterAuthLogger();
    // Sized so a quadratic scan (5.6 s at 100,000 dots) runs far past the
    // default test timeout, while a linear one takes milliseconds: the test
    // fails on a complexity regression, not on a slow machine.
    const hostile = `https://a/b?x=${".".repeat(300_000)}a`;

    log.error(`Invalid callbackURL: ${hostile}`);

    expect(errors[0]?.message).toBe("Invalid callbackURL: https://a/b");
  });

  it("keeps an error's cause chain, codes and own fields, sanitized", async () => {
    const errors = expectCoreLog("error", "Failed to create user");
    const log = await betterAuthLogger();
    const root = Object.assign(
      new Error("database unavailable at /db?password=opaque-db-secret"),
      { code: "P1001" },
    );
    const outer = Object.assign(
      new Error(
        "callback failed for https://example.invalid/cb?code=opaque-code",
        {
          cause: root,
        },
      ),
      { code: "OAUTH_CALLBACK", status: 502 },
    );
    Object.assign(root, { outer });

    log.error("Failed to create user", outer);

    const drained = JSON.stringify(errors[0]?.event);
    for (const kept of [
      "callback failed for https://example.invalid/cb",
      "OAUTH_CALLBACK",
      "database unavailable at /db",
      "P1001",
      "evlog-library-logs.test.ts",
    ]) {
      expect(drained).toContain(kept);
    }
    for (const dropped of ["opaque-code", "opaque-db-secret"]) {
      expect(drained).not.toContain(dropped);
    }
  });
});

describe("which Composio message is info", () => {
  const multiple =
    "[Warn:AllowMultiple] Multiple connected accounts found for user sokobot:bot in auth config auth-gmail";

  it.each([
    [
      "with the SDK's colored timestamp",
      `\u001b[90m2026-11-17T12:12:15.236Z\u001b[39m - ${multiple}`,
    ],
    ["with a plain timestamp", `2026-11-17T12:12:15.236Z - ${multiple}`],
    ["without a timestamp", multiple],
  ])("maps the exact warning %s to info", (_name, formatted) => {
    coreComposioSink.warn(formatted);

    expect(coreLogEvents()).toEqual([
      expect.objectContaining({
        level: "info",
        source: "composio",
        requestLogs: [expect.objectContaining({ message: multiple })],
      }),
    ]);
  });

  it.each([
    ["more after the auth config", `${multiple}; the newest one is used`],
    [
      "no user or auth config",
      "[Warn:AllowMultiple] Multiple connected accounts found",
    ],
    ["the warning inside another one", `Retrying: ${multiple}`],
    ["colors inside the message", `\u001b[33m${multiple}\u001b[39m`],
  ])("keeps a warning with %s a warning", (_name, message) => {
    const warnings = expectCoreLog("warn", "");

    coreComposioSink.warn(message);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.event.source).toBe("composio");
  });
});
