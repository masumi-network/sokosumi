import { OpenAPIHono } from "@hono/zod-openapi";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import mountGet from "./get.js";

const {
  workspaceRepositoryMock,
  prismaTaskFileFindManyMock,
  prismaTaskFileFindFirstMock,
  prismaMemberFindUniqueMock,
  listMock,
} = vi.hoisted(() => ({
  workspaceRepositoryMock: {
    resolveWorkspaceForContext: vi.fn(),
  },
  prismaTaskFileFindManyMock: vi.fn(),
  prismaTaskFileFindFirstMock: vi.fn(),
  prismaMemberFindUniqueMock: vi.fn(),
  listMock: vi.fn(),
}));

vi.mock("@sokosumi/database/repositories", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/repositories")>();
  return {
    ...actual,
    workspaceRepository: workspaceRepositoryMock,
  };
});

vi.mock("@/lib/db/prisma", () => ({
  default: {
    taskFile: {
      findMany: prismaTaskFileFindManyMock,
      findFirst: prismaTaskFileFindFirstMock,
    },
    member: {
      findUnique: prismaMemberFindUniqueMock,
    },
  },
}));

vi.mock("@/helpers/access-control", () => ({
  requireCoworkerCapability: vi.fn(),
}));

vi.mock("@/helpers/vendor-grants", () => ({
  hasGrantedWorkspaceAccess: vi.fn().mockResolvedValue(false),
  buildCoworkerTaskListAccessFilter: vi.fn().mockReturnValue({}),
}));

vi.mock("@vercel/blob", () => ({
  list: listMock,
}));

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      BLOB_READ_WRITE_TOKEN: "test-token",
      STRIPE_SECRET_KEY: "sk_test_123",
    }),
  };
});

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
  authenticationMethod: "session",
};

function createRecentsApp(
  authContext: AuthenticationContext = USER_AUTH_CONTEXT,
) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & RequestIdVariables;
  }>();

  app.onError(errorHandler);

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("requestId", "req_123");
    await next();
  });

  mountGet(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

describe("GET /v1/drive/recents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspaceRepositoryMock.resolveWorkspaceForContext.mockResolvedValue({
      id: "ws_personal",
      userId: "user_123",
      organizationId: null,
    });
    prismaTaskFileFindFirstMock.mockResolvedValue(null);
    prismaTaskFileFindManyMock.mockResolvedValue([]);
    listMock.mockResolvedValue({
      blobs: [
        {
          url: "https://blob.example/report.pdf",
          pathname: "drive/users/user_123/report.pdf",
          size: 1000,
          uploadedAt: new Date("2026-08-20T12:00:00.000Z"),
        },
      ],
      hasMore: false,
      cursor: undefined,
    });
  });

  it("returns merged recents sorted by activityAt descending", async () => {
    prismaTaskFileFindManyMock.mockResolvedValue([
      {
        id: "tf_newer",
        name: "output.pdf",
        fileUrl: "https://blob.example/output.pdf",
        size: BigInt(500),
        updatedAt: new Date("2026-08-21T12:00:00.000Z"),
        task: {
          id: "task_1",
          name: "Design",
          projectId: null,
          project: null,
        },
      },
    ]);

    const app = createRecentsApp();
    const response = await app.request("/?scope=me&limit=20");
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data).toHaveLength(2);
    expect(body.data[0].kind).toBe("task-output");
    expect(body.data[1].kind).toBe("drive-file");
    expect(body.meta.pagination.nextCursor).toBeNull();
  });

  it("returns nextCursor when more items remain", async () => {
    listMock.mockResolvedValue({
      blobs: Array.from({ length: 3 }, (_, index) => ({
        url: `https://blob.example/file-${index}.pdf`,
        pathname: `drive/users/user_123/file-${index}.pdf`,
        size: 100,
        uploadedAt: new Date(`2026-08-${20 - index}T12:00:00.000Z`),
      })),
      hasMore: true,
      cursor: "blob-page-2",
    });

    const app = createRecentsApp();
    const response = await app.request("/?scope=me&limit=2");
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data).toHaveLength(2);
    expect(body.meta.pagination.nextCursor).toBeTruthy();
  });

  it("requires organizationId for org scope", async () => {
    const app = createRecentsApp();
    const response = await app.request("/?scope=org&limit=20");
    expect(response.status).toBe(400);
  });
});
