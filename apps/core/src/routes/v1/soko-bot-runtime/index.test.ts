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
  runSandboxTool: vi.fn(),
  sandboxFileSource: vi.fn(),
  startSandboxTurn: vi.fn(),
}));
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
