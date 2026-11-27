import { SOKO_BOT_TURN_TOKEN_HEADER } from "@sokosumi/soko-bot";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { describe, expect, it, vi } from "vitest";
import { errorHandler } from "@/helpers/error-handler";
import { coreEvlogMiddleware } from "@/lib/evlog";
import { issueTurnToken } from "@/lib/soko-bot/sandbox/turn-token";
import { coreLogEvents } from "@/test/core-log";

const service = vi.hoisted(() => ({
  completeSandboxTurn: vi.fn(),
  failSandboxTurn: vi.fn(),
  grantSandboxUpload: vi.fn(),
  proxySandboxModelCall: vi.fn(),
  recordSandboxAction: vi.fn(),
  recordSandboxActionResult: vi.fn(),
  recordSandboxReasoning: vi.fn(),
  runSandboxTool: vi.fn(),
  sandboxFileSource: vi.fn(),
  sandboxPlanNote: vi.fn(),
  sandboxRecordStepFocusOutcome: vi.fn(),
  sandboxSelectStepFocus: vi.fn(),
  startSandboxTurn: vi.fn(),
}));
// PostgreSQL's clock is the test clock here, unless a test takes it down.
const databaseNow = vi.hoisted(() => vi.fn(async () => new Date()));
vi.mock("@/lib/db/database-now", () => ({ databaseNow }));
vi.mock("@/services/soko-bot-sandbox-turn.service", () => service);

const { default: runtimeRouter } = await import("./index");

const app = new Hono()
  .use(requestId())
  .use(coreEvlogMiddleware())
  .route("/v1/soko-bot-runtime", runtimeRouter)
  .onError(errorHandler);

const TURN_ID = "0196a001-0001-7001-8001-000000000001";
const OTHER_TURN_ID = "0196a001-0001-7001-8001-000000000002";
const SESSION_ID = "0196a001-0001-7001-8001-0000000000a1";

function token(turnId = TURN_ID) {
  return issueTurnToken({
    turnId,
    sessionId: SESSION_ID,
    expiresAt: Date.now() + 60_000,
  });
}

function post(
  route: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return app.request(`/v1/soko-bot-runtime/turns/${TURN_ID}${route}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [SOKO_BOT_TURN_TOKEN_HEADER]: token(),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const startFailed = {
  event: "start_failed",
  coreResponse: {
    status: 409,
    kind: CORE_API_ERROR_KINDS.SOKO_BOT_TURN_INACTIVE,
  },
  errorName: "Error",
};
const exited = {
  code: "runner_exited",
  message: "The runner ended with exit code 1",
};

describe("POST /turns/:turnId/fail with the runner's diagnostic", () => {
  it("hands Core's failure path the diagnostic", async () => {
    const response = await post("/fail", {
      ...exited,
      diagnostic: startFailed,
    });

    expect(response.status).toBe(200);
    expect(service.failSandboxTurn).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ turnId: TURN_ID, sessionId: SESSION_ID }),
      exited,
      startFailed,
    );
  });

  it("rejects another turn's token before anything runs", async () => {
    const response = await post(
      "/fail",
      { ...exited, diagnostic: startFailed },
      { [SOKO_BOT_TURN_TOKEN_HEADER]: token(OTHER_TURN_ID) },
    );

    expect(response.status).toBe(401);
    expect(service.failSandboxTurn).not.toHaveBeenCalled();
  });

  it("rejects a bad token without the database, even while it is down", async () => {
    databaseNow.mockClear();
    databaseNow.mockRejectedValueOnce(new Error("Database unavailable"));
    try {
      const response = await post(
        "/fail",
        { ...exited, diagnostic: startFailed },
        { [SOKO_BOT_TURN_TOKEN_HEADER]: token(OTHER_TURN_ID) },
      );

      expect(response.status).toBe(401);
      expect(databaseNow).not.toHaveBeenCalled();
    } finally {
      databaseNow.mockReset();
      databaseNow.mockImplementation(async () => new Date());
    }
  });

  it.each([
    ["an unknown event", { event: "anything" }],
    ["text of its own", { ...startFailed, why: "USER-WRITTEN" }],
    ["a field outside the schema", { ...startFailed, note: "USER-WRITTEN" }],
    [
      "text in coreResponse",
      { ...startFailed, coreResponse: { status: 409, kind: "USER-WRITTEN" } },
    ],
    [
      "an extra coreResponse field",
      {
        ...startFailed,
        coreResponse: { status: 409, message: "USER-WRITTEN" },
      },
    ],
    ["an unknown error name", { ...startFailed, errorName: "USER-WRITTEN" }],
    ["a status out of range", { ...startFailed, coreResponse: { status: 42 } }],
  ])(
    "drops a diagnostic with %s but still fails the turn",
    async (_name, diagnostic) => {
      const response = await post("/fail", { ...exited, diagnostic });

      expect(response.status).toBe(200);
      expect(service.failSandboxTurn).toHaveBeenCalledExactlyOnceWith(
        expect.anything(),
        exited,
        undefined,
      );
      expect(JSON.stringify(coreLogEvents())).not.toContain("USER-WRITTEN");
    },
  );
});

describe("a runtime request's wide event", () => {
  it("carries the verified turn id, so the start call joins the runner's event", async () => {
    service.startSandboxTurn.mockResolvedValue({});

    await post("/start", {});

    expect(coreLogEvents()).toContainEqual(
      expect.objectContaining({ turnId: TURN_ID }),
    );
  });
});

describe("POST /turns/:turnId/reasoning", () => {
  it("hands Core a step's reasoning summary while the turn runs", async () => {
    const response = await post("/reasoning", { text: "Checking the plan." });

    expect(response.status).toBe(200);
    expect(service.recordSandboxReasoning).toHaveBeenCalledWith(
      expect.objectContaining({ turnId: TURN_ID }),
      "Checking the plan.",
    );
  });

  it("refuses an empty summary", async () => {
    const response = await post("/reasoning", { text: "" });

    expect(response.status).toBe(400);
  });
});

describe("POST /turns/:turnId/step-focus and /step-focus/outcome", () => {
  it("delegates step-focus selection and outcome recording to Core", async () => {
    const decision = {
      decisionId: "focus_1",
      appliedFocus: "inspect" as const,
      usedFallback: false,
      allowedTools: ["list_tasks"],
      toolChoice: "auto" as const,
      verifyNote: null,
      verifyNoteKey: null,
    };
    service.sandboxSelectStepFocus.mockResolvedValueOnce(decision);

    const selectResponse = await post("/step-focus", {
      stepIndex: 0,
      roundIndex: 0,
      stepsInRound: 0,
      stepsRemaining: 20,
      recentSteps: [],
      hasAttemptedWrite: false,
      consecutiveInspect: 0,
      consecutiveVerify: 0,
      justExpandedShortForm: false,
    });

    expect(selectResponse.status).toBe(200);
    expect(await selectResponse.json()).toEqual({ decision });
    expect(service.sandboxSelectStepFocus).toHaveBeenCalledWith(
      expect.objectContaining({ turnId: TURN_ID, sessionId: SESSION_ID }),
      expect.objectContaining({ stepIndex: 0, roundIndex: 0 }),
    );

    const outcomeResponse = await post("/step-focus/outcome", {
      decisionId: "focus_1",
      stepIndex: 0,
      appliedFocus: "inspect",
      usedFallback: false,
      finishReason: "tool-calls",
      toolCalls: [{ name: "list_tasks", status: "ok" }],
      inputTokens: 1200,
      outputTokens: 80,
      cacheReadTokens: 900,
    });

    expect(outcomeResponse.status).toBe(200);
    expect(service.sandboxRecordStepFocusOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ turnId: TURN_ID, sessionId: SESSION_ID }),
      expect.objectContaining({
        decisionId: "focus_1",
        appliedFocus: "inspect",
      }),
    );
  });

  it("rejects an invalid focus value in step-focus/outcome", async () => {
    const response = await post("/step-focus/outcome", {
      decisionId: "focus_1",
      stepIndex: 0,
      appliedFocus: "invalid_focus",
      usedFallback: false,
      finishReason: "stop",
      toolCalls: [],
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
    });

    expect(response.status).toBe(400);
  });
});
