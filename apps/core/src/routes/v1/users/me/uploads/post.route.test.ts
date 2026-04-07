import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { LIMITS } from "@/config/constants";
import { formatZodErrorMessage, unprocessableEntity } from "@/helpers/error";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";

const { getEnvMock, createUserFileUploadSessionMock } = vi.hoisted(() => ({
  getEnvMock: vi.fn(() => ({
    BLOB_READ_WRITE_TOKEN: "blob-token",
  })),
  createUserFileUploadSessionMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({
  getEnv: getEnvMock,
}));

vi.mock("@/lib/blob", () => ({
  createUserFileUploadSession: (...args: unknown[]) =>
    createUserFileUploadSessionMock(...args),
}));

vi.mock("@/middleware/auth", () => ({
  requireUserAuthContext: (authContext: AuthenticationContext | null) => {
    if (!authContext || authContext.actor !== "user") {
      throw new HTTPException(403, {
        message: "User authentication required",
      });
    }

    return authContext;
  },
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
};

let mountPostUserFileUploads: (app: OpenAPIHonoWithAuth) => void;

function createApp(
  authContext: AuthenticationContext | null = USER_AUTH_CONTEXT,
) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & { requestId: string };
  }>({
    defaultHook: (result) => {
      if (!result.success && result.error) {
        throw unprocessableEntity(formatZodErrorMessage(result.error));
      }
    },
  });

  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");

    if (!authContext) {
      throw new HTTPException(401, {
        message: "Unauthorized",
      });
    }

    c.set("isAuthenticated", true);
    c.set("authContext", authContext);

    return await next();
  });

  mountPostUserFileUploads(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

beforeAll(async () => {
  const module = await import("./post");
  mountPostUserFileUploads = module.default;
});

beforeEach(() => {
  vi.clearAllMocks();
  getEnvMock.mockReturnValue({
    BLOB_READ_WRITE_TOKEN: "blob-token",
  });
  createUserFileUploadSessionMock.mockResolvedValue({
    clientToken: "client-token-123",
    access: "public",
    pathname: "users/user_123/report.pdf",
    addRandomSuffix: true,
    maxSizeBytes: LIMITS.USER_UPLOAD_MAX_SIZE_BYTES,
  });
});

describe("POST /uploads route", () => {
  it("creates a direct upload session", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/uploads", {
      method: "POST",
      body: JSON.stringify({
        filename: "report.pdf",
        contentType: "application/pdf",
        size: 2_048_000,
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    expect(response.status).toBe(201);
    expect(createUserFileUploadSessionMock).toHaveBeenCalledWith(
      "user_123",
      {
        filename: "report.pdf",
        contentType: "application/pdf",
        size: 2_048_000,
        maxSizeBytes: LIMITS.USER_UPLOAD_MAX_SIZE_BYTES,
      },
      "blob-token",
    );
  });

  it("resolves application/octet-stream from the filename when the browser omits a specific MIME type", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/uploads", {
      method: "POST",
      body: JSON.stringify({
        filename: "report.pdf",
        contentType: "application/octet-stream",
        size: 2_048_000,
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    expect(response.status).toBe(201);
    expect(createUserFileUploadSessionMock).toHaveBeenCalledWith(
      "user_123",
      {
        filename: "report.pdf",
        contentType: "application/pdf",
        size: 2_048_000,
        maxSizeBytes: LIMITS.USER_UPLOAD_MAX_SIZE_BYTES,
      },
      "blob-token",
    );
  });

  it("returns 422 for oversized uploads", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/uploads", {
      method: "POST",
      body: JSON.stringify({
        filename: "video.mp4",
        contentType: "video/mp4",
        size: LIMITS.USER_UPLOAD_MAX_SIZE_BYTES + 1,
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    expect(response.status).toBe(422);
    expect(createUserFileUploadSessionMock).not.toHaveBeenCalled();
  });

  it("returns 422 for invalid metadata", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/uploads", {
      method: "POST",
      body: JSON.stringify({
        filename: "",
        contentType: "",
        size: 0,
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    expect(response.status).toBe(422);
    expect(createUserFileUploadSessionMock).not.toHaveBeenCalled();
  });

  it("returns 422 when contentType is unsupported without a custom allowlist", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/uploads", {
      method: "POST",
      body: JSON.stringify({
        filename: "logo.bin",
        contentType: "application/octet-stream",
        size: 1000,
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    expect(response.status).toBe(422);
    expect(createUserFileUploadSessionMock).not.toHaveBeenCalled();
  });

  it("creates a session with custom size and content-type constraints", async () => {
    const app = createApp();
    createUserFileUploadSessionMock.mockResolvedValue({
      clientToken: "client-token-123",
      access: "public",
      pathname: "users/user_123/logo.png",
      addRandomSuffix: true,
      maxSizeBytes: 2_097_152,
    });

    const response = await app.request("http://localhost/uploads", {
      method: "POST",
      body: JSON.stringify({
        filename: "logo.png",
        contentType: "image/png",
        size: 1000,
        maxSizeBytes: 2_097_152,
        allowedContentTypes: ["image/png", "image/jpeg"],
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    expect(response.status).toBe(201);
    expect(createUserFileUploadSessionMock).toHaveBeenCalledWith(
      "user_123",
      {
        filename: "logo.png",
        contentType: "image/png",
        size: 1000,
        maxSizeBytes: 2_097_152,
        allowedContentTypes: ["image/png", "image/jpeg"],
      },
      "blob-token",
    );
  });

  it("returns 422 when size exceeds a custom maxSizeBytes", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/uploads", {
      method: "POST",
      body: JSON.stringify({
        filename: "logo.png",
        contentType: "image/png",
        size: 2_097_153,
        maxSizeBytes: 2_097_152,
        allowedContentTypes: ["image/png", "image/jpeg"],
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    expect(response.status).toBe(422);
    expect(createUserFileUploadSessionMock).not.toHaveBeenCalled();
  });

  it("returns 422 when contentType is not included in allowedContentTypes", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/uploads", {
      method: "POST",
      body: JSON.stringify({
        filename: "logo.pdf",
        contentType: "application/pdf",
        size: 1000,
        allowedContentTypes: ["image/png", "image/jpeg"],
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    expect(response.status).toBe(422);
    expect(createUserFileUploadSessionMock).not.toHaveBeenCalled();
  });

  it("returns 422 when allowedContentTypes contains unsupported values", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/uploads", {
      method: "POST",
      body: JSON.stringify({
        filename: "logo.bin",
        contentType: "application/octet-stream",
        size: 1000,
        allowedContentTypes: ["application/octet-stream"],
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    expect(response.status).toBe(422);
    expect(createUserFileUploadSessionMock).not.toHaveBeenCalled();
  });
});
