import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { formatZodErrorMessage, unprocessableEntity } from "@/helpers/error";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import { resolveUsersPathUserId } from "@/routes/v1/users/user-path-access";
import type { UserRouteVariables } from "@/routes/v1/users/user-route-context";

const { getEnvMock, listUserUploadsMock } = vi.hoisted(() => ({
  getEnvMock: vi.fn(() => ({
    BLOB_READ_WRITE_TOKEN: "blob-token",
  })),
  listUserUploadsMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({
  getEnv: getEnvMock,
}));

vi.mock("@/lib/blob", () => ({
  listUserUploads: (...args: unknown[]) => listUserUploadsMock(...args),
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
  role: "user",
};

let mountGetUserUploads: (app: OpenAPIHonoWithAuth<UserRouteVariables>) => void;

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

  const userByIdApp = new OpenAPIHono<{
    Variables: AuthVariables & UserRouteVariables & { requestId: string };
  }>({
    defaultHook: (result) => {
      if (!result.success && result.error) {
        throw unprocessableEntity(formatZodErrorMessage(result.error));
      }
    },
  });
  userByIdApp.use("*", async (c, next) => {
    c.set(
      "userRouteContext",
      resolveUsersPathUserId(c.var.authContext, c.req.param("id")!),
    );
    return await next();
  });
  mountGetUserUploads(
    userByIdApp as unknown as OpenAPIHonoWithAuth<UserRouteVariables>,
  );
  app.route("/:id", userByIdApp);

  return app;
}

beforeAll(async () => {
  const module = await import("../../[id]/uploads/get");
  mountGetUserUploads = module.default;
});

beforeEach(() => {
  vi.clearAllMocks();
  getEnvMock.mockReturnValue({
    BLOB_READ_WRITE_TOKEN: "blob-token",
  });
  listUserUploadsMock.mockResolvedValue([
    {
      publicUrl: "https://blob.example/users/user_123/report.pdf",
      metadata: {
        pathname: "users/user_123/report.pdf",
        downloadUrl: "https://blob.example/download/report.pdf",
        size: 5,
        uploadedAt: "2026-03-24T12:00:00.000Z",
        etag: '"etag-123"',
      },
    },
  ]);
});

describe("GET /uploads route", () => {
  it("lists uploads for the authenticated user", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/me/uploads");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(listUserUploadsMock).toHaveBeenCalledWith("user_123", "blob-token");
    expect(payload.data).toEqual([
      expect.objectContaining({
        publicUrl: "https://blob.example/users/user_123/report.pdf",
      }),
    ]);
  });
});
