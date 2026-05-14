import { Hono } from "hono";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "@/helpers/error-handler";

const {
  authGetSessionMock,
  authVerifyApiKeyMock,
  captureExceptionMock,
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
    captureExceptionMock: vi.fn(),
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

vi.mock("@sentry/node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sentry/node")>();
  return {
    ...actual,
    captureException: captureExceptionMock,
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
    hermesInstance: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(undefined),
      upsert: vi.fn().mockResolvedValue(undefined),
    },
    hermesMessage: {
      create: hermesMessageCreateMock,
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: hermesMessageFindManyMock,
      count: vi.fn().mockResolvedValue(0),
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

import { destroyInstance } from "@/clients/hermes-orchestrator.client";

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
    prismaTransactionMock.mockImplementation(async (arg: unknown) => {
      if (Array.isArray(arg)) {
        await Promise.all(arg);
        return;
      }
      if (typeof arg === "function") {
        return await (
          arg as (tx: {
            hermesMessage: { create: typeof hermesMessageCreateMock };
          }) => Promise<unknown>
        )({
          hermesMessage: {
            create: hermesMessageCreateMock,
          },
        });
      }
    });
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

  it("loads a bounded recent window of persisted history for the proxy", async () => {
    hermesMessageFindManyMock.mockResolvedValue([
      { role: "assistant", content: "Latest reply" },
      { role: "user", content: "Latest user" },
      { role: "assistant", content: "Older reply" },
    ]);

    await createApp().request("/chat", {
      method: "POST",
      headers: {
        Authorization: "Bearer test_api_key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: "New turn" }),
    });

    expect(hermesMessageFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user_123" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 100,
        select: { role: true, content: true },
      }),
    );

    expect(proxyChatCompletionsMock).toHaveBeenCalledWith(
      "user_123",
      expect.objectContaining({
        messages: [
          { role: "assistant", content: "Older reply" },
          { role: "user", content: "Latest user" },
          { role: "assistant", content: "Latest reply" },
          { role: "user", content: "New turn" },
        ],
      }),
    );
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

  it("returns 200 when DELETE /me/instance succeeds", async () => {
    vi.mocked(destroyInstance).mockResolvedValue(undefined);

    const response = await createApp().request("/me/instance", {
      method: "DELETE",
      headers: {
        Authorization: "Bearer test_api_key",
      },
    });

    const body = await parseJson(response);

    expect(response.status).toBe(200);
    expect(body).toHaveProperty("data.ok", true);
    expect(destroyInstance).toHaveBeenCalledWith("user_123");
    expect(prismaTransactionMock).toHaveBeenCalled();
  });

  it("returns 503 and reports to Sentry when orchestrator destroy succeeds but DB cleanup fails", async () => {
    vi.mocked(destroyInstance).mockResolvedValue(undefined);
    prismaTransactionMock.mockImplementation(async (arg: unknown) => {
      if (Array.isArray(arg)) {
        throw new Error("connection refused");
      }
      if (typeof arg === "function") {
        return await (
          arg as (tx: {
            hermesMessage: { create: typeof hermesMessageCreateMock };
          }) => Promise<unknown>
        )({
          hermesMessage: {
            create: hermesMessageCreateMock,
          },
        });
      }
    });

    const response = await createApp().request("/me/instance", {
      method: "DELETE",
      headers: {
        Authorization: "Bearer test_api_key",
      },
    });

    const body = await parseJson(response);

    expect(response.status).toBe(503);
    expect(body.error).toBe("ServiceUnavailable");
    expect(body.message).toBe(
      "Your Hermes instance was removed, but we could not clear related data in our system. Please try again shortly; repeating this action is safe.",
    );
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: { context: "hermes_destroy_db_cleanup" },
        extra: { userId: "user_123" },
      }),
    );
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
