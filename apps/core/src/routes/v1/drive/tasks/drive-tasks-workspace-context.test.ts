import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import mountGet from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  workspaceRepositoryMock,
  prismaTaskFileFindManyMock,
  prismaTaskFileCountMock,
  prismaTaskFindFirstMock,
} = vi.hoisted(() => ({
  workspaceRepositoryMock: {
    resolveWorkspaceForContext: vi.fn(),
  },
  prismaTaskFileFindManyMock: vi.fn(),
  prismaTaskFileCountMock: vi.fn(),
  prismaTaskFindFirstMock: vi.fn(),
}));

vi.mock("@sokosumi/database/repositories", () => ({
  workspaceRepository: workspaceRepositoryMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    taskFile: {
      findMany: prismaTaskFileFindManyMock,
      count: prismaTaskFileCountMock,
    },
    task: {
      findFirst: prismaTaskFindFirstMock,
    },
    member: {
      findUnique: vi.fn(),
    },
  },
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
  authenticationMethod: "session",
};

function createApp() {
  const app = new OpenAPIHonoWithAuth();

  app.onError(errorHandler);

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", USER_AUTH_CONTEXT);
    c.set("requestId", "req_123");
    await next();
  });

  mountGet(app);

  return app;
}

describe("Drive Tasks workspace context for task read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspaceRepositoryMock.resolveWorkspaceForContext.mockResolvedValue({
      id: "ws_personal",
      userId: "user_123",
      organizationId: null,
    });
  });

  it("reads Level 3 files when the task is in the Drive workspace", async () => {
    prismaTaskFindFirstMock.mockResolvedValue({
      id: "tsk_123",
      workspaceId: "ws_personal",
    });
    prismaTaskFileFindManyMock.mockResolvedValue([]);
    prismaTaskFileCountMock.mockResolvedValue(0);

    const res = await createApp().request(
      "http://localhost/?scope=me&taskId=tsk_123",
    );

    expect(res.status).toBe(200);
    expect(prismaTaskFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: "tsk_123",
        archivedAt: null,
        workspaceId: "ws_personal",
      },
    });
  });

  it("returns 404 when the task is not in the Drive workspace", async () => {
    prismaTaskFindFirstMock.mockResolvedValue(null);

    const res = await createApp().request(
      "http://localhost/?scope=me&taskId=tsk_other",
    );

    expect(res.status).toBe(404);
    expect(prismaTaskFileFindManyMock).not.toHaveBeenCalled();
  });
});
