import { spawn } from "node:child_process";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { SOKO_BOT_TURN_TOKEN_HEADER } from "@sokosumi/soko-bot";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serviceUnavailable } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import {
  logRunnerDiagnostic,
  type RunnerDiagnostic,
} from "@/lib/soko-bot/runner-log-events";
import { issueTurnToken } from "@/lib/soko-bot/sandbox/turn-token";
import { expectCoreLog } from "@/test/core-log";

const service = vi.hoisted(() => ({
  completeSandboxTurn: vi.fn(),
  // Core's claim on the turn row is the service's to test; this one wins it.
  failSandboxTurn: vi.fn(
    async (
      claims: { turnId: string; sessionId: string },
      _failure: unknown,
      diagnostic?: RunnerDiagnostic,
    ) => {
      if (diagnostic) logRunnerDiagnostic(claims, diagnostic);
    },
  ),
  grantSandboxUpload: vi.fn(),
  proxySandboxModelCall: vi.fn(),
  recordSandboxAction: vi.fn(),
  recordSandboxActionResult: vi.fn(),
  runSandboxTool: vi.fn(),
  sandboxFileSource: vi.fn(),
  startSandboxTurn: vi.fn(),
}));
// PostgreSQL's clock is the test clock here.
vi.mock("@/lib/db/database-now", () => ({
  databaseNow: async () => new Date(),
}));
vi.mock("@/services/soko-bot-sandbox-turn.service", () => service);

const { default: runtimeRouter } = await import(
  "@/routes/v1/soko-bot-runtime/index"
);
const core = new Hono()
  .route("/v1/soko-bot-runtime", runtimeRouter)
  .onError(errorHandler);

const TSX = fileURLToPath(
  new URL("../../node_modules/tsx/dist/cli.mjs", import.meta.url),
);
const RUNNER = fileURLToPath(new URL("./index.ts", import.meta.url));
const TURN_ID = "0196a001-0001-7001-8001-000000000001";
const PREFIX = `/v1/soko-bot-runtime/turns/${TURN_ID}/`;

const closers: (() => void)[] = [];
/** Every request the runner made, in order, with when it arrived. */
const requests: { path: string; at: number }[] = [];
afterEach(() => {
  requests.length = 0;
  for (const close of closers.splice(0)) close();
});

/**
 * Core's runtime routes behind a stand-in for the sandbox network proxy,
 * which adds the turn's token to requests for this turn's endpoints.
 */
async function coreBehindSandboxProxy(): Promise<string> {
  const token = issueTurnToken({
    turnId: TURN_ID,
    sessionId: "0196a001-0001-7001-8001-0000000000a1",
    expiresAt: Date.now() + 60_000,
  });
  const server = serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (request) => {
      const url = new URL(request.url);
      requests.push({
        path: url.pathname.slice(PREFIX.length),
        at: Date.now(),
      });
      const headers = new Headers(request.headers);
      if (url.pathname.startsWith(PREFIX))
        headers.set(SOKO_BOT_TURN_TOKEN_HEADER, token);
      return core.fetch(new Request(request, { headers }));
    },
  });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  closers.push(() => server.close());
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** The runner as the sandbox starts it: only the variables the sandbox sets. */
function runRunner(coreUrl: string) {
  return new Promise<{ code: number | null; output: string }>((resolve) => {
    const child = spawn(process.execPath, [TSX, RUNNER], {
      env: {
        PATH: process.env.PATH ?? "",
        SOKO_BOT_CORE_URL: coreUrl,
        SOKO_BOT_TURN_ID: TURN_ID,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const collect = (chunk: Buffer) => {
      output += chunk;
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("close", (code) => resolve({ code, output }));
  });
}

describe("a runner whose start call fails", () => {
  it("hands Core its diagnostic in the supervisor's failure report, which Core logs with the turn id", async () => {
    service.startSandboxTurn.mockRejectedValueOnce(serviceUnavailable());
    const entries = expectCoreLog(
      "error",
      "A Soko Bot turn could not start in its sandbox",
    );

    const { code, output } = await runRunner(await coreBehindSandboxProxy());

    expect(code).toBe(1);
    // Its own output in the sandbox still has it.
    expect(output).toContain("A Soko Bot turn could not start in its sandbox");
    // Nothing between the start call and the failure report delays it.
    expect(requests.map((request) => request.path)).toEqual(["start", "fail"]);
    const [start, fail] = requests;
    expect((fail?.at ?? 0) - (start?.at ?? 0)).toBeLessThan(2_000);
    expect(service.failSandboxTurn).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ turnId: TURN_ID }),
      {
        code: "runner_exited",
        message:
          "The runner ended with exit code 1: A Soko Bot turn could not start in its sandbox (Core answered 503)",
      },
      {
        event: "start_failed",
        coreResponse: { status: 503 },
        errorName: "Error",
      },
    );
    expect(entries[0]?.event).toMatchObject({
      turnId: TURN_ID,
      source: "soko-bot-runner",
      coreResponse: { status: 503 },
      errorName: "Error",
    });
    // Core's own message is the runner's cause; it stays in the sandbox.
    expect(JSON.stringify(entries[0]?.event)).not.toContain(
      "Service Unavailable",
    );
  }, 30_000);
});

it("completes a turn when older Core sends only an absolute deadline", async () => {
  service.startSandboxTurn.mockResolvedValueOnce({
    message: "Hello",
    system: "Reply with a greeting.",
    model: "google/gemini-3.6-flash",
    capabilities: [],
    deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    maxSteps: 1,
  });
  service.proxySandboxModelCall.mockResolvedValueOnce({
    status: 200,
    contentType: "text/event-stream",
    body: [
      { type: "text-start", id: "answer" },
      { type: "text-delta", id: "answer", delta: "Hello there." },
      { type: "text-end", id: "answer" },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "stop" },
        usage: { inputTokens: { total: 10 }, outputTokens: { total: 3 } },
      },
    ]
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join(""),
  });

  const result = await runRunner(await coreBehindSandboxProxy());

  expect(result.code, result.output).toBe(0);
  expect(service.completeSandboxTurn).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ turnId: TURN_ID }),
    { text: "Hello there.", finishReason: "stop" },
  );
}, 30_000);
