import { Hono } from "hono";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";

const {
  getEnvMock,
  handleUploadPresignedMock,
  registerTaskFileFromUploadCompletedMock,
} = vi.hoisted(() => {
  const defaultEnv = {
    // Pulled at import time via `@/lib/hono` → auth → prisma/postmark.
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    POSTMARK_SERVER_ID: "test-postmark-token",
    BLOB_WEBHOOK_PUBLIC_KEY:
      "-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----",
    BLOB_READ_WRITE_TOKEN: "blob-token",
  };
  return {
    getEnvMock: vi.fn(() => ({ ...defaultEnv })),
    handleUploadPresignedMock: vi.fn(),
    registerTaskFileFromUploadCompletedMock: vi.fn(),
  };
});

vi.mock("@/config/env", () => ({
  getEnv: getEnvMock,
}));

vi.mock("@/clients/postmark.client", () => ({
  postmarkClient: { sendEmail: vi.fn() },
}));

// `@/lib/hono` → auth → stripe/postmark at import time.
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(),
      verifyApiKey: vi.fn(),
    },
  },
}));

vi.mock("@vercel/blob", () => ({
  BlobError: class BlobError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "BlobError";
    }
  },
}));

vi.mock("@vercel/blob/client", () => ({
  handleUploadPresigned: handleUploadPresignedMock,
}));

vi.mock("@/lib/task-file-upload-completed", () => ({
  TaskFileUploadClientError: class TaskFileUploadClientError extends Error {
    readonly name = "TaskFileUploadClientError";
  },
  registerTaskFileFromUploadCompleted: registerTaskFileFromUploadCompletedMock,
}));

import uploadedRouter from "./uploaded";

function createApp() {
  const app = new Hono<{ Variables: RequestIdVariables }>();
  app.use("*", async (c, next) => {
    c.set("requestId", "req_blob_webhook_test");
    await next();
  });
  app.onError(errorHandler);
  app.route("/", uploadedRouter);
  return app;
}

describe("POST /webhooks/tasks/files/uploaded", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEnvMock.mockReturnValue({
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      POSTMARK_SERVER_ID: "test-postmark-token",
      BLOB_WEBHOOK_PUBLIC_KEY:
        "-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----",
      BLOB_READ_WRITE_TOKEN: "blob-token",
    });
    handleUploadPresignedMock.mockResolvedValue({
      type: "blob.upload-completed",
      response: "ok",
    });
  });

  it("accepts upload-completed JSON without Content-Type (Blob callback shape)", async () => {
    const app = createApp();
    const payload = {
      type: "blob.upload-completed",
      payload: {
        blob: {
          url: "https://store.public.blob.vercel-storage.com/tasks/tsk_1/hello.txt",
          pathname: "tasks/tsk_1/hello.txt",
          contentType: "text/plain",
          contentDisposition: 'attachment; filename="hello.txt"',
        },
        tokenPayload: JSON.stringify({ taskId: "tsk_1" }),
      },
    };

    const response = await app.request("http://localhost/uploaded", {
      method: "POST",
      // Intentionally omit Content-Type — Vercel Blob callbacks may do this.
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      type: "blob.upload-completed",
      response: "ok",
    });
    expect(handleUploadPresignedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: payload,
        webhookPublicKey: expect.stringContaining("BEGIN PUBLIC KEY"),
      }),
    );
  });

  it("returns 400 for invalid JSON", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/uploaded", {
      method: "POST",
      body: "not-json",
    });

    expect(response.status).toBe(400);
    expect(handleUploadPresignedMock).not.toHaveBeenCalled();
  });

  it("returns 503 when webhook public key is missing", async () => {
    getEnvMock.mockReturnValue({
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      POSTMARK_SERVER_ID: "test-postmark-token",
      BLOB_READ_WRITE_TOKEN: "blob-token",
      BLOB_WEBHOOK_PUBLIC_KEY: undefined,
    } as unknown as ReturnType<typeof getEnvMock>);

    const app = createApp();
    const response = await app.request("http://localhost/uploaded", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "blob.upload-completed", payload: {} }),
    });

    expect(response.status).toBe(503);
    expect(handleUploadPresignedMock).not.toHaveBeenCalled();
  });
});
