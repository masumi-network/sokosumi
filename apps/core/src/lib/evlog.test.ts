import type { DrainContext } from "evlog";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { RequestIdVariables } from "hono/request-id";
import { requestId } from "hono/request-id";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const waitUntilMock = vi.hoisted(() => vi.fn());

vi.mock("@vercel/functions", () => ({
  waitUntil: (promise: Promise<unknown>) => waitUntilMock(promise),
}));

import { errorHandler } from "@/helpers/error-handler";
import { uploadCoworkerImage } from "@/lib/blob";
import { createBlobUploadGrant } from "@/lib/blob-upload-grant";
import {
  attachAuthToLogger,
  attachUploadToLogger,
  attachWorkspaceToLogger,
  bindCoreRequestContext,
  coreEvlogMiddleware,
  createCoreLogger,
  initCoreLogger,
} from "@/lib/evlog";
import type { AuthVariables } from "@/middleware/auth";
import { setAuthContext } from "@/middleware/auth";

const { issueSignedTokenMock, presignUrlMock, putMock, getEnvMock } =
  vi.hoisted(() => ({
    issueSignedTokenMock: vi.fn(),
    presignUrlMock: vi.fn(),
    putMock: vi.fn(),
    getEnvMock: vi.fn(),
  }));

vi.mock("@vercel/blob", () => ({
  issueSignedToken: issueSignedTokenMock,
  presignUrl: presignUrlMock,
  put: putMock,
}));

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  getEnvMock.mockImplementation(() => actual.getEnv());
  return {
    ...actual,
    getEnv: getEnvMock,
  };
});

vi.mock("@sentry/node", () => ({
  captureException: vi.fn(),
  getCurrentScope: () => ({
    setUser: vi.fn(),
    setContext: vi.fn(),
  }),
}));

vi.mock("@/lib/external-service-errors", () => ({
  captureExternalServiceError: vi.fn(),
}));

const captured: DrainContext[] = [];

function createApp() {
  const app = new Hono<{
    Variables: RequestIdVariables & AuthVariables;
  }>();
  app.use(requestId());
  app.use(coreEvlogMiddleware());
  app.use(bindCoreRequestContext());
  return app;
}

describe("core evlog request events", () => {
  beforeEach(() => {
    captured.length = 0;
    delete process.env.SENTRY_DSN;
    initCoreLogger({
      silent: true,
      drain: (ctx) => {
        captured.push(ctx);
      },
    });
  });

  it("emits one wide event with method, path, status, and Core requestId", async () => {
    const app = createApp();
    app.get("/v1/jobs", (c) =>
      c.json({
        data: { jobs: [] },
        meta: { requestId: c.var.requestId },
      }),
    );
    const response = await app.request("http://localhost/v1/jobs");
    const body = (await response.json()) as {
      meta: { requestId: string };
    };

    expect(response.status).toBe(200);
    expect(captured).toHaveLength(1);

    const ctx = captured[0];
    expect(ctx?.request?.method).toBe("GET");
    expect(ctx?.request?.path).toBe("/v1/jobs");
    expect(ctx?.event.status).toBe(200);
    expect(ctx?.event.requestId).toBe(body.meta.requestId);
    expect(body.meta.requestId).toEqual(expect.any(String));
  });

  it("labels the wide event with the route template, not the token path", async () => {
    const app = createApp();
    app.get("/v1/share/:token", (c) => c.json({ ok: true }));

    const pathToken = "share-capability-token";
    const response = await app.request(
      `http://localhost/v1/share/${pathToken}`,
    );

    expect(response.status).toBe(200);
    expect(captured).toHaveLength(1);

    // createSentryDrain sends `event.path` to Sentry as both the log body and
    // an attribute, on every request. Only `event` is transmitted.
    expect(captured[0]?.event.path).toBe("/v1/share/:token");
    expect(JSON.stringify(captured[0]?.event)).not.toContain(pathToken);
  });

  it("labels a wide event for an unmatched request without the raw path", async () => {
    const app = createApp();

    const rawPath = "/v1/not-a-route/some-secret-slug";
    const response = await app.request(`http://localhost${rawPath}`);

    expect(response.status).toBe(404);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.event.path).toBe("UNMATCHED");
    expect(JSON.stringify(captured[0]?.event)).not.toContain(
      "some-secret-slug",
    );
  });

  it("reuses an incoming X-Request-Id on the wide event and envelope", async () => {
    const app = createApp();
    app.get("/v1/jobs", (c) =>
      c.json({
        meta: { requestId: c.var.requestId },
      }),
    );

    const response = await app.request("http://localhost/v1/jobs", {
      headers: { "X-Request-Id": "req_from_web" },
    });
    const body = (await response.json()) as { meta: { requestId: string } };

    expect(body.meta.requestId).toBe("req_from_web");
    expect(captured[0]?.event.requestId).toBe("req_from_web");
  });

  it("does not emit a wide event for the OpenAPI snapshot", async () => {
    const app = createApp();
    app.get("/v1/openapi.json", (c) => c.json({ openapi: "3.1.0" }));
    const response = await app.request("http://localhost/v1/openapi.json");

    expect(response.status).toBe(200);
    expect(captured).toHaveLength(0);
  });

  it("adds actor, user, organization, and workspace ids on authenticated requests", async () => {
    const app = createApp();
    app.use(async (_c, next) => {
      attachAuthToLogger({
        actor: "user",
        userId: "user_123",
        organizationId: "org_456",
      });
      attachWorkspaceToLogger({
        workspaceId: "ws_789",
        userId: "user_123",
        organizationId: "org_456",
      });
      return await next();
    });
    app.get("/v1/tasks", (c) =>
      c.json({ meta: { requestId: c.var.requestId } }),
    );

    const response = await app.request("http://localhost/v1/tasks");

    expect(response.status).toBe(200);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.event.actor).toBe("user");
    expect(captured[0]?.event.user).toEqual({ id: "user_123" });
    expect(captured[0]?.event.organization).toEqual({ id: "org_456" });
    expect(captured[0]?.event.workspace).toEqual({
      id: "ws_789",
      userId: "user_123",
      organizationId: "org_456",
    });
  });

  it("setAuthContext copies the authenticated user onto the wide event", async () => {
    const app = createApp();
    app.use(async (c, next) => {
      setAuthContext(c as never, {
        isAuthenticated: true,
        authContext: {
          actor: "user",
          userId: "user_123",
          organizationId: "org_456",
          role: "user",
        },
      });
      return await next();
    });
    app.get("/v1/me", (c) => c.json({ ok: true }));

    await app.request("http://localhost/v1/me");

    expect(captured[0]?.event.actor).toBe("user");
    expect(captured[0]?.event.user).toEqual({ id: "user_123" });
    expect(captured[0]?.event.organization).toEqual({ id: "org_456" });
  });

  it("setAuthContext copies coworker and soko bot identity onto the wide event", async () => {
    const app = createApp();
    app.use("/v1/coworker", async (c, next) => {
      setAuthContext(c as never, {
        isAuthenticated: true,
        authContext: {
          actor: "coworker",
          coworkerId: "cw_1",
          vendorId: "vnd_1",
          context: { userId: "user_9", organizationId: "org_9" },
        },
      });
      return await next();
    });
    app.get("/v1/coworker", (c) => c.json({ ok: true }));

    await app.request("http://localhost/v1/coworker");

    expect(captured[0]?.event.actor).toBe("coworker");
    expect(captured[0]?.event.coworker).toEqual({ id: "cw_1" });
    expect(captured[0]?.event.context).toEqual({
      userId: "user_9",
      organizationId: "org_9",
    });
  });

  it("keeps expected 4xx HTTPExceptions at info on the wide event", async () => {
    // evlog 2.28 captures `c.error` after `app.onError`. errorHandler clears
    // that for expected 4xx so Sentry Logs do not treat them as failures.
    const app = createApp();
    app.onError(errorHandler);
    app.get("/v1/fail", () => {
      throw new HTTPException(409, { message: "Conflict" });
    });

    const response = await app.request("http://localhost/v1/fail");

    expect(response.status).toBe(409);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.event.status).toBe(409);
    expect(captured[0]?.event.level).toBe("info");
  });

  it("marks unexpected 5xx errors on the wide event", async () => {
    const app = createApp();
    app.onError(errorHandler);
    app.get("/v1/fail", () => {
      throw new Error("boom");
    });

    const response = await app.request("http://localhost/v1/fail");

    expect(response.status).toBe(500);
    expect(captured[0]?.event.status).toBe(500);
    expect(captured[0]?.event.level).toBe("error");
  });

  it("adds upload filename, size, and mimeType on the wide event", async () => {
    const app = createApp();
    app.post("/v1/uploads", (c) => {
      attachUploadToLogger({
        filename: "document.pdf",
        size: 1_024_000,
        mimeType: "application/pdf",
      });
      return c.json({ ok: true });
    });

    const response = await app.request("http://localhost/v1/uploads", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.event.upload).toEqual({
      filename: "document.pdf",
      size: 1_024_000,
      mimeType: "application/pdf",
    });
  });

  it("adds upload fields when a blob upload grant is minted", async () => {
    issueSignedTokenMock.mockResolvedValue({
      delegationToken: "delegation",
      clientSigningToken: "signing",
      validUntil: Date.now() + 60_000,
    });
    presignUrlMock.mockResolvedValue({
      presignedUrl: "https://blob.example/upload?sig=1",
    });

    const app = createApp();
    app.post("/v1/uploads", async (c) => {
      await createBlobUploadGrant({
        pathname: "users/user_123/document.pdf",
        contentType: "application/pdf",
        maximumSizeInBytes: 1_024_000,
        maxSizeBytes: 104_857_600,
        access: "public",
        addRandomSuffix: true,
        token: "rw-token",
      });
      return c.json({ ok: true });
    });

    const response = await app.request("http://localhost/v1/uploads", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(captured[0]?.event.upload).toEqual({
      filename: "document.pdf",
      size: 1_024_000,
      mimeType: "application/pdf",
    });
  });

  it("adds stored pathname basename when a coworker image is uploaded", async () => {
    const env = getEnvMock();
    getEnvMock.mockReturnValueOnce({
      ...env,
      BLOB_READ_WRITE_TOKEN: "rw_token",
    });
    putMock.mockResolvedValue({
      url: "https://blob.example/coworkers/cow-1/image-Ops_Logo_1-xyz.png",
    });

    const app = createApp();
    app.post("/v1/coworkers/image", async (c) => {
      await uploadCoworkerImage({
        coworkerId: "01960001-0001-7001-8001-000000000099",
        bytes: Buffer.from("png-bytes"),
        contentType: "image/png",
        filename: " Ops Logo (1).png ",
      });
      return c.json({ ok: true });
    });

    const response = await app.request("http://localhost/v1/coworkers/image", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(captured[0]?.event.upload).toEqual({
      filename: "image-Ops_Logo_1.png",
      size: 9,
      mimeType: "image/png",
    });
  });
});

describe("core standalone logger drain", () => {
  afterEach(() => {
    waitUntilMock.mockReset();
    vi.unstubAllEnvs();
  });

  it("emits standalone events through the initCoreLogger drain", async () => {
    const drain = vi.fn();
    initCoreLogger({ silent: true, drain });

    createCoreLogger({ chat: { kind: "coworker_channel_mention" } }).emit();
    await Promise.resolve();

    expect(drain).toHaveBeenCalledTimes(1);
    expect(drain.mock.calls[0]?.[0]?.event.chat).toEqual({
      kind: "coworker_channel_mention",
    });
  });

  it("registers Vercel waitUntil so standalone drain work can finish", async () => {
    vi.stubEnv("VERCEL", "1");
    const drain = vi.fn(async () => {});
    initCoreLogger({ silent: true, drain });

    createCoreLogger({ chat: { kind: "coworker_channel_mention" } }).emit();

    expect(waitUntilMock).toHaveBeenCalledOnce();
    await waitUntilMock.mock.calls[0]?.[0];
    expect(drain).toHaveBeenCalledTimes(1);
  });
});
