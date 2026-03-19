import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { LIMITS } from "@/config/constants";
import { formatZodErrorMessage, unprocessableEntity } from "@/helpers/error";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";

const { getEnvMock, uploadUserFileMock } = vi.hoisted(() => ({
  getEnvMock: vi.fn(() => ({
    BLOB_READ_WRITE_TOKEN: "blob-token",
  })),
  uploadUserFileMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({
  getEnv: getEnvMock,
}));

vi.mock("@/lib/blob", () => ({
  uploadUserFile: uploadUserFileMock,
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

let mountPostUserFile: (app: OpenAPIHonoWithAuth) => void;

function createApp(authContext: AuthenticationContext | null = USER_AUTH_CONTEXT) {
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

  mountPostUserFile(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

beforeAll(async () => {
  const module = await import("./post");
  mountPostUserFile = module.default;
});

beforeEach(() => {
  vi.clearAllMocks();
  getEnvMock.mockReturnValue({
    BLOB_READ_WRITE_TOKEN: "blob-token",
  });
  uploadUserFileMock.mockResolvedValue({
    publicUrl: "https://blob.example/users/user_123/report.pdf",
    metadata: {
      pathname: "users/user_123/report.pdf",
      downloadUrl: "https://blob.example/download/report.pdf",
      size: 5,
      uploadedAt: "2026-03-19T12:00:00.000Z",
      etag: '"etag-123"',
    },
  });
});

describe("POST /files route", () => {
  it("uploads successfully without attempting to read the body twice", async () => {
    const app = createApp();
    const formData = new FormData();
    formData.set(
      "file",
      new File(["hello"], "report.pdf", {
        type: "application/pdf",
      }),
    );

    const response = await app.request("http://localhost/files", {
      method: "POST",
      body: formData,
    });

    expect(response.status).toBe(201);
    expect(uploadUserFileMock).toHaveBeenCalledWith(
      "user_123",
      expect.any(File),
      "blob-token",
    );
  });

  it("returns 422 when file is missing", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/files", {
      method: "POST",
      body: new FormData(),
    });

    expect(response.status).toBe(422);
    expect(uploadUserFileMock).not.toHaveBeenCalled();
  });

  it("returns 422 when file is empty", async () => {
    const app = createApp();
    const formData = new FormData();
    formData.set("file", new File([], "empty.txt", { type: "text/plain" }));

    const response = await app.request("http://localhost/files", {
      method: "POST",
      body: formData,
    });

    expect(response.status).toBe(422);
    expect(uploadUserFileMock).not.toHaveBeenCalled();
  });

  it("returns 422 when file exceeds maximum size", async () => {
    const app = createApp();
    const formData = new FormData();
    formData.set(
      "file",
      new File(
        [new Uint8Array(LIMITS.USER_UPLOAD_MAX_SIZE_BYTES + 1)],
        "too-large.bin",
        {
          type: "application/octet-stream",
        },
      ),
    );

    const response = await app.request("http://localhost/files", {
      method: "POST",
      body: formData,
    });

    expect(response.status).toBe(422);
    expect(uploadUserFileMock).not.toHaveBeenCalled();
  });

  it("returns 422 when multiple files are provided", async () => {
    const app = createApp();
    const formData = new FormData();
    formData.append("file", new File(["a"], "a.txt", { type: "text/plain" }));
    formData.append("file", new File(["b"], "b.txt", { type: "text/plain" }));

    const response = await app.request("http://localhost/files", {
      method: "POST",
      body: formData,
    });

    expect(response.status).toBe(422);
    expect(uploadUserFileMock).not.toHaveBeenCalled();
  });
});
