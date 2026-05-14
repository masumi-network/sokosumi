import { Hono } from "hono";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "@/helpers/error-handler";

const {
  authGetSessionMock,
  authVerifyApiKeyMock,
  ensureInstanceReadyMock,
  HermesInstanceNotReadyErrorMock,
  hermesMessageCreateMock,
  hermesMessageFindManyMock,
  isReservedSecretKeyMock,
  isValidSecretKeyMock,
  prismaTransactionMock,
  proxyChatCompletionsMock,
  userFindUniqueMock,
} = vi.hoisted(() => {
  class HermesInstanceNotReadyErrorMock extends Error {
    readonly status:
      | "provisioning"
      | "running"
      | "suspended"
      | "error"
      | "missing";

    constructor(
      status: "provisioning" | "running" | "suspended" | "error" | "missing",
    ) {
      super(`Hermes instance not ready (${status})`);
      this.status = status;
    }
  }

  return {
    authGetSessionMock: vi.fn(),
    authVerifyApiKeyMock: vi.fn(),
    ensureInstanceReadyMock: vi.fn(),
    HermesInstanceNotReadyErrorMock,
    hermesMessageCreateMock: vi.fn(),
    hermesMessageFindManyMock: vi.fn(),
    isReservedSecretKeyMock: vi.fn(),
    isValidSecretKeyMock: vi.fn(),
    prismaTransactionMock: vi.fn(),
    proxyChatCompletionsMock: vi.fn(),
    userFindUniqueMock: vi.fn(),
  };
});

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: authGetSessionMock,
      verifyApiKey: authVerifyApiKeyMock,
    },
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
    hermesMessage: {
      create: hermesMessageCreateMock,
      findMany: hermesMessageFindManyMock,
    },
    user: {
      findUnique: userFindUniqueMock,
    },
  },
}));

vi.mock("@/clients/hermes-orchestrator.client", () => ({
  destroyInstance: vi.fn(),
  ensureInstanceReady: ensureInstanceReadyMock,
  getInstance: vi.fn(),
  HermesInstanceNotReadyError: HermesInstanceNotReadyErrorMock,
  HermesOrchestratorError: class HermesOrchestratorError extends Error {
    readonly httpStatus: number;
    readonly code: string;

    constructor(httpStatus: number, body: { code?: string; title?: string }) {
      super(body.title ?? `Hermes orchestrator error (${httpStatus})`);
      this.httpStatus = httpStatus;
      this.code = body.code ?? "HERMES_ORCH_ERROR";
    }
  },
  isReservedSecretKey: isReservedSecretKeyMock,
  isValidSecretKey: isValidSecretKeyMock,
  provisionInstance: vi.fn(),
  proxyChatCompletions: proxyChatCompletionsMock,
  setInstanceSecret: vi.fn(),
}));

import hermesRouter from "./index";

function createApp() {
  const app = new Hono<{ Variables: RequestIdVariables }>();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_hermes_route_test");
    return await next();
  });
  app.route("/", hermesRouter);
  app.onError(errorHandler);

  return app;
}

async function parseJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("Hermes route contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    authGetSessionMock.mockResolvedValue(null);
    authVerifyApiKeyMock.mockResolvedValue({
      valid: true,
      key: { referenceId: "user_123" },
    });
    userFindUniqueMock.mockResolvedValue({ role: "user" });
    hermesMessageFindManyMock.mockResolvedValue([]);
    hermesMessageCreateMock.mockResolvedValue(undefined);
    ensureInstanceReadyMock.mockResolvedValue(undefined);
    proxyChatCompletionsMock.mockResolvedValue(
      Response.json({
        choices: [
          {
            message: {
              role: "assistant",
              content: "Hello from Hermes.",
            },
          },
        ],
      }),
    );
    prismaTransactionMock.mockImplementation(
      async (
        callback: (tx: {
          hermesMessage: { create: typeof hermesMessageCreateMock };
        }) => Promise<unknown>,
      ) =>
        await callback({
          hermesMessage: {
            create: hermesMessageCreateMock,
          },
        }),
    );
    isReservedSecretKeyMock.mockReturnValue(false);
    isValidSecretKeyMock.mockReturnValue(true);
  });

  it("returns 401 when authentication is missing", async () => {
    const response = await createApp().request("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Hello" }),
    });

    const body = await parseJson(response);

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
    expect(body.message).toBe("Invalid, expired or missing session");
  });

  it("returns a useful validation message for an empty chat request", async () => {
    const response = await createApp().request("/chat", {
      method: "POST",
      headers: {
        Authorization: "Bearer test_api_key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: "   " }),
    });

    const body = await parseJson(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("BadRequest");
    expect(body.message).toBe(
      "Message content or at least one file is required.",
    );
    expect(body).not.toHaveProperty("details");
  });

  it("returns chat messages under data.message in the standard envelope", async () => {
    const response = await createApp().request("/chat", {
      method: "POST",
      headers: {
        Authorization: "Bearer test_api_key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: "Hello" }),
    });

    const body = await parseJson(response);

    expect(response.status).toBe(200);
    expect(body).toHaveProperty("data.message", {
      role: "assistant",
      content: "Hello from Hermes.",
    });
    expect(body).toHaveProperty("meta.timestamp");
    expect(body).toHaveProperty("meta.requestId", "req_hermes_route_test");
    expect(body).not.toHaveProperty("message");
    expect(hermesMessageCreateMock).toHaveBeenCalledTimes(2);
  });

  it("returns instance-not-ready 409 as data/meta with data.status only", async () => {
    ensureInstanceReadyMock.mockRejectedValue(
      new HermesInstanceNotReadyErrorMock("provisioning"),
    );

    const response = await createApp().request("/chat", {
      method: "POST",
      headers: {
        Authorization: "Bearer test_api_key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: "Hello" }),
    });

    const body = await parseJson(response);

    expect(response.status).toBe(409);
    expect(Object.keys(body).sort()).toEqual(["data", "meta"]);
    expect(body.data).toEqual({ status: "provisioning" });
    expect(Object.keys(body.data as Record<string, unknown>)).toEqual([
      "status",
    ]);
    expect(body).not.toHaveProperty("error");
    expect(body).not.toHaveProperty("message");
    expect(body).not.toHaveProperty("details");
    expect(body).toHaveProperty("meta.requestId", "req_hermes_route_test");
    expect(proxyChatCompletionsMock).not.toHaveBeenCalled();
  });

  it("documents the chat and instance-not-ready envelopes in OpenAPI", () => {
    const doc = hermesRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Hermes API",
        version: "1.0.0",
      },
    });
    expect(doc.paths).toBeDefined();

    const postChat = doc.paths?.["/chat"]?.post;
    const okResponse = postChat?.responses?.[200];
    const conflictResponse = postChat?.responses?.[409];

    expect(okResponse?.description).toContain("data.message");
    expect(conflictResponse?.description).toContain("data/meta envelope");
  });
});
