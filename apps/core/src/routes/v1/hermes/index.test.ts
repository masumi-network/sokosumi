import { Hono } from "hono";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "@/helpers/error-handler";

const {
  addBreadcrumbMock,
  approveConfirmationMock,
  authGetSessionMock,
  authVerifyApiKeyMock,
  buildMcpUrlMock,
  captureExceptionMock,
  captureMessageMock,
  composioToolkitForProviderMock,
  connectInstanceIntegrationMock,
  disconnectInstanceIntegrationMock,
  coworkerFindManyMock,
  ensureInstanceReadyMock,
  ensureAuthConfigMock,
  ensureMcpServerMock,
  getConnectionMock,
  HermesInstanceNotReadyErrorMock,
  hermesPendingConnectionDeleteManyMock,
  hermesPendingConnectionDeleteMock,
  hermesPendingConnectionFindUniqueMock,
  hermesPendingConnectionUpsertMock,
  hermesMessageCreateMock,
  hermesMessageFindManyMock,
  hermesMessageUpsertMock,
  initiateConnectionMock,
  isReservedSecretKeyMock,
  isValidSecretKeyMock,
  memberFindFirstMock,
  organizationFindManyMock,
  orchestratorApiKeyFindUniqueMock,
  prismaTransactionMock,
  proxyChatCompletionsMock,
  syncHermesInboxForUserMock,
  userFindUniqueMock,
  waitUntilMock,
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
    addBreadcrumbMock: vi.fn(),
    approveConfirmationMock: vi.fn(),
    authGetSessionMock: vi.fn(),
    authVerifyApiKeyMock: vi.fn(),
    buildMcpUrlMock: vi.fn(),
    captureExceptionMock: vi.fn(),
    captureMessageMock: vi.fn(),
    composioToolkitForProviderMock: vi.fn(),
    connectInstanceIntegrationMock: vi.fn(),
    disconnectInstanceIntegrationMock: vi.fn(),
    coworkerFindManyMock: vi.fn(),
    ensureInstanceReadyMock: vi.fn(),
    ensureAuthConfigMock: vi.fn(),
    ensureMcpServerMock: vi.fn(),
    getConnectionMock: vi.fn(),
    HermesInstanceNotReadyErrorMock,
    hermesPendingConnectionDeleteManyMock: vi.fn(),
    hermesPendingConnectionDeleteMock: vi.fn(),
    hermesPendingConnectionFindUniqueMock: vi.fn(),
    hermesPendingConnectionUpsertMock: vi.fn(),
    hermesMessageCreateMock: vi.fn(),
    hermesMessageFindManyMock: vi.fn(),
    hermesMessageUpsertMock: vi.fn(),
    initiateConnectionMock: vi.fn(),
    isReservedSecretKeyMock: vi.fn(),
    isValidSecretKeyMock: vi.fn(),
    memberFindFirstMock: vi.fn(),
    organizationFindManyMock: vi.fn(),
    orchestratorApiKeyFindUniqueMock: vi.fn(),
    prismaTransactionMock: vi.fn(),
    proxyChatCompletionsMock: vi.fn(),
    syncHermesInboxForUserMock: vi.fn(),
    userFindUniqueMock: vi.fn(),
    waitUntilMock: vi.fn(),
  };
});

vi.mock("@sentry/node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sentry/node")>();
  return {
    ...actual,
    addBreadcrumb: addBreadcrumbMock,
    captureException: captureExceptionMock,
    captureMessage: captureMessageMock,
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
      upsert: hermesMessageUpsertMock,
      count: vi.fn().mockResolvedValue(0),
    },
    coworker: {
      findMany: coworkerFindManyMock,
    },
    hermesPendingConnection: {
      upsert: hermesPendingConnectionUpsertMock,
      findUnique: hermesPendingConnectionFindUniqueMock,
      delete: hermesPendingConnectionDeleteMock,
      deleteMany: hermesPendingConnectionDeleteManyMock,
    },
    member: {
      findFirst: memberFindFirstMock,
    },
    organization: {
      findMany: organizationFindManyMock,
    },
    orchestratorApiKey: {
      findUnique: orchestratorApiKeyFindUniqueMock,
    },
    user: {
      findUnique: userFindUniqueMock,
    },
  },
}));

vi.mock("@/clients/hermes-orchestrator.client", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/clients/hermes-orchestrator.client")
    >();

  return {
    ...actual,
    approveConfirmation: approveConfirmationMock,
    connectInstanceIntegration: connectInstanceIntegrationMock,
    disconnectInstanceIntegration: disconnectInstanceIntegrationMock,
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
  };
});

vi.mock("@/clients/composio.client", () => ({
  buildMcpUrl: buildMcpUrlMock,
  ComposioApiError: class ComposioApiError extends Error {
    readonly httpStatus: number;
    readonly body: unknown;

    constructor(message: string, httpStatus = 500, body: unknown = null) {
      super(message);
      this.httpStatus = httpStatus;
      this.body = body;
    }
  },
  ComposioConfigError: class ComposioConfigError extends Error {},
  composioToolkitForProvider: composioToolkitForProviderMock,
  ensureAuthConfig: ensureAuthConfigMock,
  ensureMcpServer: ensureMcpServerMock,
  getConnection: getConnectionMock,
  initiateConnection: initiateConnectionMock,
}));

vi.mock("@/services/hermes-inbox-sync.service", () => ({
  syncHermesInboxForUser: syncHermesInboxForUserMock,
}));

vi.mock("@vercel/functions", () => ({
  waitUntil: waitUntilMock,
}));

import {
  destroyInstance,
  getInstance,
  HermesOrchestratorError,
} from "@/clients/hermes-orchestrator.client";

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
    orchestratorApiKeyFindUniqueMock.mockResolvedValue(null);
    userFindUniqueMock.mockResolvedValue({ role: "user" });
    hermesMessageFindManyMock.mockResolvedValue([]);
    hermesMessageCreateMock.mockResolvedValue(undefined);
    hermesMessageUpsertMock.mockResolvedValue(undefined);
    ensureInstanceReadyMock.mockResolvedValue(undefined);
    syncHermesInboxForUserMock.mockResolvedValue({
      userId: "user_123",
      outcome: "no_messages",
    });
    coworkerFindManyMock.mockResolvedValue([]);
    memberFindFirstMock.mockResolvedValue(null);
    organizationFindManyMock.mockResolvedValue([]);
    hermesPendingConnectionUpsertMock.mockResolvedValue(undefined);
    hermesPendingConnectionFindUniqueMock.mockResolvedValue(null);
    hermesPendingConnectionDeleteMock.mockResolvedValue(undefined);
    hermesPendingConnectionDeleteManyMock.mockResolvedValue({ count: 0 });
    composioToolkitForProviderMock.mockReturnValue("gmail");
    ensureAuthConfigMock.mockResolvedValue("auth_config_1");
    ensureMcpServerMock.mockResolvedValue("mcp_server_1");
    initiateConnectionMock.mockResolvedValue({
      redirectUrl: "https://composio.example/oauth",
      connectionId: "conn_123",
    });
    getConnectionMock.mockResolvedValue({ status: "ACTIVE" });
    buildMcpUrlMock.mockReturnValue("https://mcp.example/gmail/user_123");
    connectInstanceIntegrationMock.mockResolvedValue({
      provider: "gmail",
      status: "connected",
      connectedAt: "2026-05-25T10:00:00.000Z",
      mode: "read",
    });
    disconnectInstanceIntegrationMock.mockResolvedValue(undefined);
    approveConfirmationMock.mockResolvedValue({
      status: "approved",
      result: null,
      error: null,
    });
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
            hermesMessage: {
              create: typeof hermesMessageCreateMock;
              upsert: typeof hermesMessageUpsertMock;
            };
          }) => Promise<unknown>
        )({
          hermesMessage: {
            create: hermesMessageCreateMock,
            upsert: hermesMessageUpsertMock,
          },
        });
      }
    });
    isReservedSecretKeyMock.mockReturnValue(false);
    isValidSecretKeyMock.mockReturnValue(true);
    vi.mocked(getInstance).mockResolvedValue(null);
    waitUntilMock.mockImplementation((promise: Promise<unknown>) => {
      promise.catch(() => undefined);
    });
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

  it.each([
    {
      label: "bare orchestrator key",
      contextHeaders: undefined,
    },
    {
      label: "orchestrator key with workspace context",
      contextHeaders: { "X-Context-User-Id": "user_123" },
    },
  ] as const)(
    "returns 403 for $label on Hermes product routes",
    async ({ contextHeaders }) => {
      orchestratorApiKeyFindUniqueMock.mockResolvedValue({
        orchestratorId: "orch_123",
        revokedAt: null,
        expiresAt: null,
        orchestrator: { archivedAt: null },
      });
      userFindUniqueMock.mockResolvedValue({ id: "user_123", role: "user" });

      const response = await createApp().request("/me/instance", {
        headers: {
          Authorization: "Bearer orch_test_secret",
          ...contextHeaders,
        },
      });

      const body = await parseJson(response);

      expect(response.status).toBe(403);
      expect(body.error).toBe("Forbidden");
      expect(body.message).toBe("User authentication required");
      expect(getInstance).not.toHaveBeenCalled();
    },
  );

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
    expect(hermesMessageUpsertMock).toHaveBeenCalledTimes(2);
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

  /** 1×1 PNG (minimal valid). */
  const tinyPngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  it("accepts application/octet-stream when the data URL declares a supported image type", async () => {
    await createApp().request("/chat", {
      method: "POST",
      headers: {
        Authorization: "Bearer test_api_key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: "Describe this",
        files: [
          {
            name: "upload.bin",
            type: "application/octet-stream",
            dataUrl: `data:image/png;base64,${tinyPngBase64}`,
          },
        ],
      }),
    });

    expect(proxyChatCompletionsMock).toHaveBeenCalledWith(
      "user_123",
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: expect.arrayContaining([
              expect.objectContaining({
                type: "image_url",
                image_url: {
                  url: `data:image/png;base64,${tinyPngBase64}`,
                },
              }),
            ]),
          }),
        ]),
      }),
    );
  });

  it("accepts application/octet-stream for PNG bytes when the data URL is also generic", async () => {
    await createApp().request("/chat", {
      method: "POST",
      headers: {
        Authorization: "Bearer test_api_key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: "Describe this",
        files: [
          {
            name: "upload.bin",
            type: "application/octet-stream",
            dataUrl: `data:application/octet-stream;base64,${tinyPngBase64}`,
          },
        ],
      }),
    });

    expect(proxyChatCompletionsMock).toHaveBeenCalledWith(
      "user_123",
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: expect.arrayContaining([
              expect.objectContaining({
                type: "image_url",
                image_url: {
                  url: `data:image/png;base64,${tinyPngBase64}`,
                },
              }),
            ]),
          }),
        ]),
      }),
    );
  });

  /** Minimal PDF header (`%PDF-1.7` plus newline) as base64. */
  const tinyPdfBase64 = "JVBERi0xLjcK";

  it("forwards PDF attachments as OpenRouter-compatible file parts", async () => {
    await createApp().request("/chat", {
      method: "POST",
      headers: {
        Authorization: "Bearer test_api_key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: "Summarize this",
        files: [
          {
            name: "x.pdf",
            type: "application/pdf",
            dataUrl: `data:application/pdf;base64,${tinyPdfBase64}`,
          },
        ],
      }),
    });

    expect(proxyChatCompletionsMock).toHaveBeenCalledWith(
      "user_123",
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: expect.arrayContaining([
              expect.objectContaining({
                type: "file",
                file: {
                  filename: "x.pdf",
                  file_data: `data:application/pdf;base64,${tinyPdfBase64}`,
                },
              }),
            ]),
          }),
        ]),
      }),
    );
  });

  it("returns 400 for an explicitly unsupported client MIME type", async () => {
    const response = await createApp().request("/chat", {
      method: "POST",
      headers: {
        Authorization: "Bearer test_api_key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: "Hi",
        files: [
          {
            name: "x.exe",
            type: "application/x-msdownload",
            dataUrl: "data:application/x-msdownload;base64,AA==",
          },
        ],
      }),
    });

    const body = await parseJson(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("BadRequest");
    expect(body.message).toBe(
      "Unsupported file type: application/x-msdownload.",
    );
    expect(proxyChatCompletionsMock).not.toHaveBeenCalled();
  });

  it("does not append a truncation marker when UTF-8 byte size exceeds the limit but the decoded string fits", async () => {
    const utf8ThreeByteChar = "\u3042";
    const repeatCount = Math.ceil((200 * 1024 + 1) / 3);
    const plain = utf8ThreeByteChar.repeat(repeatCount);
    expect(Buffer.byteLength(plain, "utf8")).toBeGreaterThan(200 * 1024);
    expect(plain.length).toBeLessThan(200 * 1024);

    const response = await createApp().request("/chat", {
      method: "POST",
      headers: {
        Authorization: "Bearer test_api_key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: "Read attachment",
        files: [
          {
            name: "dense.txt",
            type: "text/plain",
            dataUrl: `data:text/plain;base64,${Buffer.from(plain, "utf8").toString("base64")}`,
          },
        ],
      }),
    });

    expect(response.status).toBe(200);

    const [, body] = proxyChatCompletionsMock.mock.calls[0] ?? [];
    expect(body).toEqual(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: expect.not.stringContaining("...(truncated)"),
          }),
        ]),
      }),
    );
  });

  it("appends a truncation marker only when decoded text is sliced shorter than the full string", async () => {
    const plain = "a".repeat(200 * 1024 + 1);

    const response = await createApp().request("/chat", {
      method: "POST",
      headers: {
        Authorization: "Bearer test_api_key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: "Read attachment",
        files: [
          {
            name: "long.txt",
            type: "text/plain",
            dataUrl: `data:text/plain;base64,${Buffer.from(plain, "utf8").toString("base64")}`,
          },
        ],
      }),
    });

    expect(response.status).toBe(200);

    const [, body] = proxyChatCompletionsMock.mock.calls[0] ?? [];
    expect(body).toEqual(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: expect.stringContaining("...(truncated)"),
          }),
        ]),
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

  it("does not persist the user turn before proxy success, so a retry does not duplicate history", async () => {
    proxyChatCompletionsMock.mockRejectedValueOnce(
      new TypeError("fetch failed"),
    );

    const first = await createApp().request("/chat", {
      method: "POST",
      headers: {
        Authorization: "Bearer test_api_key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: "Hello" }),
    });

    expect(first.status).toBe(503);
    expect(hermesMessageCreateMock).not.toHaveBeenCalled();

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

    const second = await createApp().request("/chat", {
      method: "POST",
      headers: {
        Authorization: "Bearer test_api_key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: "Hello" }),
    });

    expect(second.status).toBe(200);
    expect(proxyChatCompletionsMock).toHaveBeenCalledWith(
      "user_123",
      expect.objectContaining({
        messages: [{ role: "user", content: "Hello" }],
      }),
    );
    expect(hermesMessageUpsertMock).toHaveBeenCalledTimes(2);
  });

  it("returns 503 when the Hermes proxy fetch fails at the network layer", async () => {
    vi.useFakeTimers();
    proxyChatCompletionsMock.mockRejectedValue(new TypeError("fetch failed"));

    try {
      const response = await createApp().request("/chat", {
        method: "POST",
        headers: {
          Authorization: "Bearer test_api_key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "Hello" }),
      });

      const body = await parseJson(response);

      expect(response.status).toBe(503);
      expect(body.error).toBe("ServiceUnavailable");
      expect(body.message).toBe("Your assistant is temporarily unavailable.");
      expect(captureExceptionMock).toHaveBeenCalledWith(
        expect.any(TypeError),
        expect.objectContaining({
          tags: { context: "hermes_proxy_fetch" },
          extra: { userId: "user_123" },
        }),
      );
      expect(syncHermesInboxForUserMock).toHaveBeenCalledWith(
        "user_123",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(waitUntilMock).toHaveBeenCalledWith(expect.any(Promise));
      expect(hermesMessageCreateMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns 200 with assistant content when the transcript cannot be persisted after a successful proxy", async () => {
    vi.useFakeTimers();
    hermesMessageUpsertMock.mockRejectedValue(new Error("db down"));

    try {
      const responsePromise = createApp().request("/chat", {
        method: "POST",
        headers: {
          Authorization: "Bearer test_api_key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "Hello" }),
      });

      await vi.runAllTimersAsync();
      const response = await responsePromise;
      const body = await parseJson(response);

      expect(response.status).toBe(200);
      expect(body).toHaveProperty("data.message.content", "Hello from Hermes.");
      expect(proxyChatCompletionsMock).toHaveBeenCalled();
      expect(captureExceptionMock).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          tags: { context: "hermes_chat_transcript_persist" },
          extra: { userId: "user_123" },
        }),
      );
      expect(syncHermesInboxForUserMock).not.toHaveBeenCalled();
      expect(waitUntilMock).toHaveBeenCalledWith(expect.any(Promise));
    } finally {
      vi.useRealTimers();
    }
  });

  it("persists the chat transcript on inline retry after a transient DB failure", async () => {
    vi.useFakeTimers();
    hermesMessageUpsertMock
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValue(undefined);

    try {
      const responsePromise = createApp().request("/chat", {
        method: "POST",
        headers: {
          Authorization: "Bearer test_api_key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "Hello" }),
      });

      await vi.runAllTimersAsync();
      const response = await responsePromise;

      expect(response.status).toBe(200);
      expect(hermesMessageUpsertMock).toHaveBeenCalledTimes(3);
      expect(waitUntilMock).not.toHaveBeenCalled();
      expect(syncHermesInboxForUserMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([401, 403, 429] as const)(
    "returns 503 when ensureInstanceReady fails with orchestrator HTTP %i",
    async (httpStatus) => {
      ensureInstanceReadyMock.mockRejectedValue(
        new HermesOrchestratorError(httpStatus, {
          title: "Orchestrator integration error",
        }),
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

      expect(response.status).toBe(503);
      expect(body.error).toBe("ServiceUnavailable");
      expect(body.message).toBe("Your assistant is temporarily unavailable.");
      expect(proxyChatCompletionsMock).not.toHaveBeenCalled();
    },
  );

  it("returns 200 for GET /me/instance and skips welcome persist when onboardedAt is null", async () => {
    vi.mocked(getInstance).mockResolvedValue({
      status: "ready",
      endpointUrl: null,
      lastActivityAt: null,
      onboardedAt: null,
      autonomyLevel: "medium",
      integrations: [],
      transitioning: false,
      welcomeMessage: "Welcome back.",
      welcomeKind: "returning",
      lastSokosumiSyncAt: null,
      lastInboxRefreshAt: null,
      timezone: null,
      pendingConfirmations: [],
    });

    const response = await createApp().request("/me/instance", {
      headers: {
        Authorization: "Bearer test_api_key",
      },
    });

    const body = await parseJson(response);

    expect(response.status).toBe(200);
    expect(body).toHaveProperty("data.hasInstance", true);
    expect(body).toHaveProperty("data.instance.onboardedAt", null);
    expect(hermesMessageUpsertMock).not.toHaveBeenCalled();
  });

  it("enriches pending confirmations with referenced coworkers + organizations on GET /me/instance", async () => {
    const coworkerId = "0e8c93b0-5332-4734-b603-ea18d17b50c5";
    const orgId = "11111111-2222-3333-4444-555555555555";
    const strangerId = "ffffffff-ffff-ffff-ffff-ffffffffffff";

    vi.mocked(getInstance).mockResolvedValue({
      status: "ready",
      endpointUrl: null,
      lastActivityAt: null,
      onboardedAt: null,
      autonomyLevel: "medium",
      integrations: [],
      transitioning: false,
      welcomeMessage: null,
      welcomeKind: null,
      lastSokosumiSyncAt: null,
      lastInboxRefreshAt: null,
      timezone: null,
      pendingConfirmations: [
        {
          id: "conf_1",
          toolName: "sokosumi_create_task",
          summary: `Create a new task and assign it to coworker ${coworkerId.toUpperCase()} in organization ${orgId.toUpperCase()}. Unknown user ${strangerId}.`,
          createdAt: "2026-05-25T10:00:00.000Z",
          referencedCoworkers: [],
          referencedOrganizations: [],
          organizationId: orgId,
          organizationName: "Acme Inc",
        },
      ],
    });
    coworkerFindManyMock.mockResolvedValue([
      { id: coworkerId, name: "Hannah", image: "https://img/hannah.png" },
    ]);
    organizationFindManyMock.mockResolvedValue([
      { id: orgId, name: "Sokosumi Inc", slug: "sokosumi" },
    ]);

    const response = await createApp().request("/me/instance", {
      headers: { Authorization: "Bearer test_api_key" },
    });
    const body = await parseJson(response);

    expect(response.status).toBe(200);
    expect(coworkerFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user_123",
          id: { in: expect.arrayContaining([coworkerId, orgId, strangerId]) },
        }),
      }),
    );
    const data = body.data as {
      instance: {
        pendingConfirmations: Array<{
          referencedCoworkers: Array<{ id: string; name: string }>;
          referencedOrganizations: Array<{ id: string; name: string }>;
        }>;
      };
    };
    const [conf] = data.instance.pendingConfirmations;
    expect(conf.referencedCoworkers).toEqual([
      { id: coworkerId, name: "Hannah", image: "https://img/hannah.png" },
    ]);
    expect(conf.referencedOrganizations).toEqual([
      { id: orgId, name: "Sokosumi Inc", slug: "sokosumi" },
    ]);
  });

  it("persists the pending connection claim when initiating integration OAuth", async () => {
    const response = await createApp().request(
      "/me/instance/integrations/initiate",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer test_api_key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ provider: "gmail", mode: "read" }),
      },
    );
    const body = await parseJson(response);

    expect(response.status).toBe(200);
    expect(body).toHaveProperty("data.provider", "gmail");
    expect(body).toHaveProperty(
      "data.redirectUrl",
      "https://composio.example/oauth",
    );
    expect(hermesPendingConnectionUpsertMock).toHaveBeenCalledWith({
      where: { connectionId: "conn_123" },
      create: {
        connectionId: "conn_123",
        userId: "user_123",
        provider: "gmail",
        mode: "read",
        expiresAt: expect.any(Date),
      },
      update: {
        userId: "user_123",
        provider: "gmail",
        mode: "read",
        expiresAt: expect.any(Date),
      },
    });
    expect(hermesPendingConnectionDeleteManyMock).toHaveBeenCalledWith({
      where: { expiresAt: { lt: expect.any(Date) } },
    });
  });

  it("finalizes an active integration and clears the pending connection", async () => {
    hermesPendingConnectionFindUniqueMock.mockResolvedValue({
      userId: "user_123",
      provider: "gmail",
      mode: "read",
      expiresAt: new Date(Date.now() + 60_000),
    });

    const response = await createApp().request(
      "/me/instance/integrations/finalize",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer test_api_key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: "gmail",
          connectionId: "conn_123",
          mode: "read",
        }),
      },
    );
    const body = await parseJson(response);

    expect(response.status).toBe(200);
    expect(getConnectionMock).toHaveBeenCalledWith("conn_123");
    expect(connectInstanceIntegrationMock).toHaveBeenCalledWith("user_123", {
      provider: "gmail",
      mcpUrl: "https://mcp.example/gmail/user_123",
      mode: "read",
    });
    expect(hermesPendingConnectionDeleteMock).toHaveBeenCalledWith({
      where: { connectionId: "conn_123" },
    });
    expect(body).toHaveProperty("data.provider", "gmail");
    expect(body).toHaveProperty("data.status", "connected");
  });

  it("rejects finalize for an unknown pending connection", async () => {
    hermesPendingConnectionFindUniqueMock.mockResolvedValue(null);

    const response = await createApp().request(
      "/me/instance/integrations/finalize",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer test_api_key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: "gmail",
          connectionId: "conn_unknown",
          mode: "read",
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(getConnectionMock).not.toHaveBeenCalled();
    expect(hermesPendingConnectionDeleteMock).not.toHaveBeenCalled();
  });

  it("rejects finalize for an expired pending connection and removes it", async () => {
    hermesPendingConnectionFindUniqueMock.mockResolvedValue({
      userId: "user_123",
      provider: "gmail",
      mode: "read",
      expiresAt: new Date(Date.now() - 60_000),
    });

    const response = await createApp().request(
      "/me/instance/integrations/finalize",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer test_api_key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: "gmail",
          connectionId: "conn_expired",
          mode: "read",
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(getConnectionMock).not.toHaveBeenCalled();
    expect(hermesPendingConnectionDeleteMock).toHaveBeenCalledWith({
      where: { connectionId: "conn_expired" },
    });
  });

  it("rejects finalize when provider or mode does not match the pending claim", async () => {
    hermesPendingConnectionFindUniqueMock.mockResolvedValue({
      userId: "user_123",
      provider: "gmail",
      mode: "read",
      expiresAt: new Date(Date.now() + 60_000),
    });

    const response = await createApp().request(
      "/me/instance/integrations/finalize",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer test_api_key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: "slack",
          connectionId: "conn_123",
          mode: "read",
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(getConnectionMock).not.toHaveBeenCalled();
    expect(hermesPendingConnectionDeleteMock).not.toHaveBeenCalled();
  });

  it.each([401, 403, 429] as const)(
    "returns 503 when GET /me/instance fails with orchestrator HTTP %i",
    async (httpStatus) => {
      vi.mocked(getInstance).mockRejectedValue(
        new HermesOrchestratorError(httpStatus, {
          title: "Orchestrator integration error",
        }),
      );

      const response = await createApp().request("/me/instance", {
        headers: {
          Authorization: "Bearer test_api_key",
        },
      });

      const body = await parseJson(response);

      expect(response.status).toBe(503);
      expect(body.error).toBe("ServiceUnavailable");
      expect(body.message).toBe("Your assistant is temporarily unavailable.");
    },
  );

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
      "Your assistant instance was removed, but we could not clear related data in our system. Please try again shortly; repeating this action is safe.",
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

  it("forwards approve-time organization override after membership check", async () => {
    const orgId = "11111111-2222-3333-4444-555555555555";
    memberFindFirstMock.mockResolvedValue({ id: "mem_1" });

    const response = await createApp().request(
      "/me/instance/confirmations/conf_1/approve",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer test_api_key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          overrides: { organizationId: orgId },
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(memberFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user_123", organizationId: orgId },
      }),
    );
    expect(approveConfirmationMock).toHaveBeenCalledWith("user_123", "conf_1", {
      organizationId: orgId,
    });
  });

  it("rejects approve with overrides for an org the user is not a member of", async () => {
    memberFindFirstMock.mockResolvedValue(null);

    const response = await createApp().request(
      "/me/instance/confirmations/conf_1/approve",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer test_api_key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          overrides: { organizationId: "ffffffff-ffff-ffff-ffff-ffffffffffff" },
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(approveConfirmationMock).not.toHaveBeenCalled();
  });

  it("treats explicit null organization overrides as personal scope and skips membership check", async () => {
    const response = await createApp().request(
      "/me/instance/confirmations/conf_1/approve",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer test_api_key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          overrides: { organizationId: null },
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(memberFindFirstMock).not.toHaveBeenCalled();
    expect(approveConfirmationMock).toHaveBeenCalledWith("user_123", "conf_1", {
      organizationId: null,
    });
  });

  it("approves without overrides when body is omitted (Hermes' original args stand)", async () => {
    const response = await createApp().request(
      "/me/instance/confirmations/conf_1/approve",
      {
        method: "POST",
        headers: { Authorization: "Bearer test_api_key" },
      },
    );

    expect(response.status).toBe(200);
    expect(approveConfirmationMock).toHaveBeenCalledWith(
      "user_123",
      "conf_1",
      undefined,
    );
  });
});
