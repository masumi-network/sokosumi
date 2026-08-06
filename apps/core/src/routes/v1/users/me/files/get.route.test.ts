import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { formatZodErrorMessage, unprocessableEntity } from "@/helpers/error";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "@/routes/v1/users/user-route-context";

const { getEnvMock, listUserUploadsMock, userFindUniqueMock } = vi.hoisted(
  () => ({
    getEnvMock: vi.fn(() => ({
      BLOB_READ_WRITE_TOKEN: "blob-token",
    })),
    listUserUploadsMock: vi.fn(),
    userFindUniqueMock: vi.fn(),
  }),
);

vi.mock("@/config/env", () => ({
  getEnv: getEnvMock,
}));

vi.mock("@/lib/blob", () => ({
  listUserUploads: (...args: unknown[]) => listUserUploadsMock(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: {
      findUnique: userFindUniqueMock,
    },
  },
}));

vi.mock("@/middleware/auth", () => ({
  hasAdminRole: (role: string | null | undefined) =>
    role?.split(",").some((value) => value.trim().toLowerCase() === "admin") ??
    false,
  isUserAuthContext: (
    authContext: AuthenticationContext | null,
  ): authContext is Extract<AuthenticationContext, { actor: "user" }> =>
    authContext?.actor === "user",
  isOrchestratorAuthContext: (
    authContext: AuthenticationContext | null,
  ): authContext is Extract<AuthenticationContext, { actor: "orchestrator" }> =>
    authContext?.actor === "orchestrator",
  requireUserAuthContext: (authContext: AuthenticationContext | null) => {
    if (!authContext || authContext.actor !== "user") {
      throw new HTTPException(403, {
        message: "User authentication required",
      });
    }

    return authContext;
  },
  requireUserContext: (authContext: AuthenticationContext | null) => {
    if (!authContext) {
      throw new HTTPException(403, {
        message: "User authentication required",
      });
    }
    if (authContext.actor === "user") {
      return { source: "session" as const, ...authContext };
    }
    if (
      (authContext.actor === "orchestrator" ||
        authContext.actor === "coworker") &&
      authContext.context
    ) {
      return {
        source: "context" as const,
        userId: authContext.context.userId,
        organizationId: authContext.context.organizationId,
      };
    }
    throw new HTTPException(403, {
      message:
        "Context headers (X-Context-User-Id) are required for this resource",
    });
  },
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

let mountGetUserFiles: (app: OpenAPIHonoWithAuth<UserRouteVariables>) => void;

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
  userByIdApp.use("*", usersPathUserContextMiddleware);
  mountGetUserFiles(
    userByIdApp as unknown as OpenAPIHonoWithAuth<UserRouteVariables>,
  );
  app.route("/:id", userByIdApp);

  return app;
}

beforeAll(async () => {
  const module = await import("../../[id]/files/get");
  mountGetUserFiles = module.default;
});

beforeEach(() => {
  vi.clearAllMocks();
  getEnvMock.mockReturnValue({
    BLOB_READ_WRITE_TOKEN: "blob-token",
  });
  userFindUniqueMock.mockResolvedValue({ id: "user_123" });
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

describe("GET /files route", () => {
  it("lists uploads for the authenticated user", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/me/files");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(userFindUniqueMock).toHaveBeenCalledWith({
      where: { id: "user_123" },
      select: { id: true },
    });
    expect(listUserUploadsMock).toHaveBeenCalledWith("user_123", "blob-token");
    expect(payload.data).toEqual([
      expect.objectContaining({
        publicUrl: "https://blob.example/users/user_123/report.pdf",
      }),
    ]);
  });
});
