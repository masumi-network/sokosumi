import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { getRequestListener } from "@hono/node-server";
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
async function coreBehindSandboxProxy(options?: {
  dropToolRequests?: boolean;
}): Promise<string> {
  const token = issueTurnToken({
    turnId: TURN_ID,
    sessionId: "0196a001-0001-7001-8001-0000000000a1",
    expiresAt: Date.now() + 60_000,
  });
  const listener = getRequestListener((request) => {
    const url = new URL(request.url);
    requests.push({
      path: url.pathname.slice(PREFIX.length),
      at: Date.now(),
    });
    const headers = new Headers(request.headers);
    if (url.pathname.startsWith(PREFIX))
      headers.set(SOKO_BOT_TURN_TOKEN_HEADER, token);
    return core.fetch(new Request(request, { headers }));
  });
  const server = createServer((req, res) => {
    if (options?.dropToolRequests && req.url?.includes("/tools/")) {
      requests.push({
        path: new URL(req.url, "http://127.0.0.1").pathname.slice(
          PREFIX.length,
        ),
        at: Date.now(),
      });
      req.socket.destroy();
      return;
    }
    return listener(req, res);
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
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

it("classifies dropped tool responses as uncertain for paid calls and transient for a read-only control", async () => {
  const contactId = "0196a001-0001-7001-8001-000000000011";
  const listId = "0196a001-0001-7001-8001-000000000012";
  const taskId = "0196a001-0001-7001-8001-000000000022";
  const gatewayBodies: string[] = [];

  service.startSandboxTurn.mockResolvedValueOnce({
    message: "Research investors and check task status",
    system: "Use the tools and follow recovery notes.",
    model: "google/gemini-3.6-flash",
    capabilities: [
      "find_investors",
      "find_people",
      "investor_warm_paths",
      "get_task_status",
    ],
    deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    maxSteps: 4,
    typedToolErrors: true,
  });

  service.proxySandboxModelCall
    .mockImplementationOnce(async (_turn, req: { body: string }) => {
      gatewayBodies.push(req.body);
      return {
        status: 200,
        contentType: "text/event-stream",
        body: [
          {
            type: "tool-call",
            toolCallId: "call_investors",
            toolName: "find_investors",
            input: JSON.stringify({
              brief: "Seed stage fintech investors in Europe",
              size: 10,
            }),
          },
          {
            type: "tool-call",
            toolCallId: "call_people",
            toolName: "find_people",
            input: JSON.stringify({ listId, size: 10 }),
          },
          {
            type: "tool-call",
            toolCallId: "call_warm_paid",
            toolName: "investor_warm_paths",
            input: JSON.stringify({ contactId, research: true }),
          },
          {
            type: "tool-call",
            toolCallId: "call_warm_read",
            toolName: "investor_warm_paths",
            input: JSON.stringify({ contactId, research: false }),
          },
          {
            type: "tool-call",
            toolCallId: "call_task_read",
            toolName: "get_task_status",
            input: JSON.stringify({ taskId }),
          },
          {
            type: "finish",
            finishReason: { unified: "tool-calls", raw: "tool_calls" },
            usage: { inputTokens: { total: 10 }, outputTokens: { total: 10 } },
          },
        ]
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join(""),
      };
    })
    .mockImplementationOnce(async (_turn, req: { body: string }) => {
      gatewayBodies.push(req.body);
      return {
        status: 200,
        contentType: "text/event-stream",
        body: [
          { type: "text-start", id: "answer" },
          {
            type: "text-delta",
            id: "answer",
            delta: "I will check state before retrying paid work.",
          },
          { type: "text-end", id: "answer" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage: { inputTokens: { total: 20 }, outputTokens: { total: 10 } },
          },
        ]
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join(""),
      };
    });

  const result = await runRunner(
    await coreBehindSandboxProxy({ dropToolRequests: true }),
  );

  expect(result.code, result.output).toBe(0);
  expect(gatewayBodies).toHaveLength(2);
  const stepTwoRequest = JSON.parse(gatewayBodies[1] ?? "{}") as {
    prompt?: Array<{ role?: string; content?: unknown }>;
  };
  const recoveryMessage = stepTwoRequest.prompt?.find(
    (msg) =>
      msg.role === "user" &&
      JSON.stringify(msg.content).includes(
        "Tool error recovery note (from Core, not the owner):",
      ),
  );
  const recoveryText = JSON.stringify(recoveryMessage?.content ?? "");
  expect(recoveryText).toContain(
    '- find_investors: {\\"kind\\":\\"uncertain\\",\\"retryable\\":false',
  );
  expect(recoveryText).toContain(
    '- find_people: {\\"kind\\":\\"uncertain\\",\\"retryable\\":false',
  );
  expect(recoveryText).toContain(
    '- investor_warm_paths: {\\"kind\\":\\"uncertain\\",\\"retryable\\":false',
  );
  expect(recoveryText).toContain(
    '- investor_warm_paths: {\\"kind\\":\\"transient\\",\\"retryable\\":true',
  );
  expect(recoveryText).toContain(
    '- get_task_status: {\\"kind\\":\\"transient\\",\\"retryable\\":true',
  );
}, 30_000);
