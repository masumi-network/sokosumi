import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import mountGet from "./get.js";

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
  head: vi.fn(async (pathname: string) => {
    const uploadedAtByPath: Record<string, string> = {
      "drive/users/user_123/file-0.pdf": "2026-08-20T12:00:00.000Z",
      "drive/users/user_123/file-1.pdf": "2026-08-19T12:00:00.000Z",
      "drive/users/user_123/file-2.pdf": "2026-08-18T12:00:00.000Z",
      "drive/users/user_123/report.pdf": "2026-08-21T12:00:00.000Z",
      "drive/users/user_123/report-copy.pdf": "2026-08-20T12:00:00.000Z",
      "drive/users/user_123/older-report.pdf": "2026-08-18T12:00:00.000Z",
      "drive/users/user_123/newer-report.pdf": "2026-08-21T12:00:00.000Z",
    };
    return {
      url: `https://blob.example/${pathname}`,
      pathname,
      size: 100,
      uploadedAt: new Date(
        uploadedAtByPath[pathname] ?? "2026-08-19T10:00:00.000Z",
      ),
    };
  }),
}));

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      BLOB_READ_WRITE_TOKEN: "test-token",
      STRIPE_SECRET_KEY: "sk_test_123",
      BETTER_AUTH_SECRET: "test-better-auth-secret",
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
  const app = new OpenAPIHonoWithAuth();

  app.onError(errorHandler);

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("requestId", "req_123");
    await next();
  });

  mountGet(app);
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
    listMock.mockImplementation(async (options?: { cursor?: string }) => {
      if (options?.cursor === "blob-page-2") {
        return {
          blobs: [],
          hasMore: false,
        };
      }

      return {
        blobs: Array.from({ length: 3 }, (_, index) => ({
          url: `https://blob.example/file-${index}.pdf`,
          pathname: `drive/users/user_123/file-${index}.pdf`,
          size: 100,
          uploadedAt: new Date(`2026-08-${20 - index}T12:00:00.000Z`),
        })),
        hasMore: true,
        cursor: "blob-page-2",
      };
    });

    const app = createRecentsApp();
    const response = await app.request("/?scope=me&limit=2");
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data).toHaveLength(2);
    expect(body.meta.pagination.nextCursor).toBeTruthy();
  });

  it("paginates without search when more items remain", async () => {
    listMock.mockImplementation(async (options?: { cursor?: string }) => {
      if (options?.cursor === "blob-page-2") {
        return {
          blobs: [
            {
              url: "https://blob.example/file-2.pdf",
              pathname: "drive/users/user_123/file-2.pdf",
              size: 100,
              uploadedAt: new Date("2026-08-18T12:00:00.000Z"),
            },
          ],
          hasMore: false,
        };
      }

      return {
        blobs: [
          {
            url: "https://blob.example/file-0.pdf",
            pathname: "drive/users/user_123/file-0.pdf",
            size: 100,
            uploadedAt: new Date("2026-08-20T12:00:00.000Z"),
          },
          {
            url: "https://blob.example/file-1.pdf",
            pathname: "drive/users/user_123/file-1.pdf",
            size: 100,
            uploadedAt: new Date("2026-08-19T12:00:00.000Z"),
          },
        ],
        hasMore: true,
        cursor: "blob-page-2",
      };
    });

    const app = createRecentsApp();
    const firstResponse = await app.request("/?scope=me&limit=1");
    expect(firstResponse.status).toBe(200);

    const firstBody = await firstResponse.json();
    expect(firstBody.data).toHaveLength(1);
    expect(firstBody.data[0].name).toBe("file-0.pdf");
    expect(firstBody.meta.pagination.nextCursor).toBeTruthy();

    const secondResponse = await app.request(
      `/?scope=me&limit=1&cursor=${encodeURIComponent(firstBody.meta.pagination.nextCursor)}`,
    );
    expect(secondResponse.status).toBe(200);

    const secondBody = await secondResponse.json();
    expect(secondBody.data).toHaveLength(1);
    expect(secondBody.data[0].name).toBe("file-1.pdf");
  });

  it("requires organizationId for org scope", async () => {
    const app = createRecentsApp();
    const response = await app.request("/?scope=org&limit=20");
    expect(response.status).toBe(422);
  });

  it("filters drive files and task outputs when q is set", async () => {
    listMock.mockResolvedValue({
      blobs: [
        {
          url: "https://blob.example/report.pdf",
          pathname: "drive/users/user_123/report.pdf",
          size: 1000,
          uploadedAt: new Date("2026-08-21T12:00:00.000Z"),
        },
        {
          url: "https://blob.example/notes.pdf",
          pathname: "drive/users/user_123/notes.pdf",
          size: 500,
          uploadedAt: new Date("2026-08-20T12:00:00.000Z"),
        },
      ],
      hasMore: false,
      cursor: undefined,
    });
    prismaTaskFileFindManyMock.mockResolvedValue([
      {
        id: "tf_mockup",
        name: "output.pdf",
        fileUrl: "https://blob.example/output.pdf",
        size: BigInt(500),
        updatedAt: new Date("2026-08-22T12:00:00.000Z"),
        task: {
          id: "task_1",
          name: "Design mockup",
          projectId: null,
          project: null,
        },
      },
    ]);

    const app = createRecentsApp();
    const response = await app.request("/?scope=me&limit=20&q=mockup");
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].kind).toBe("task-output");
    expect(body.data[0].taskName).toBe("Design mockup");
    expect(prismaTaskFileFindManyMock).toHaveBeenCalled();
  });

  it("filters drive files by filename when q is set", async () => {
    listMock.mockResolvedValue({
      blobs: [
        {
          url: "https://blob.example/report.pdf",
          pathname: "drive/users/user_123/report.pdf",
          size: 1000,
          uploadedAt: new Date("2026-08-21T12:00:00.000Z"),
        },
        {
          url: "https://blob.example/notes.pdf",
          pathname: "drive/users/user_123/notes.pdf",
          size: 500,
          uploadedAt: new Date("2026-08-20T12:00:00.000Z"),
        },
      ],
      hasMore: false,
      cursor: undefined,
    });
    prismaTaskFileFindManyMock.mockResolvedValue([]);

    const app = createRecentsApp();
    const response = await app.request("/?scope=me&limit=20&q=report");
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].kind).toBe("drive-file");
    expect(body.data[0].name).toBe("report.pdf");
  });

  it("paginates search results with cursor while keeping q applied", async () => {
    listMock.mockResolvedValue({
      blobs: [
        {
          url: "https://blob.example/report.pdf",
          pathname: "drive/users/user_123/report.pdf",
          size: 1000,
          uploadedAt: new Date("2026-08-21T12:00:00.000Z"),
        },
        {
          url: "https://blob.example/report-copy.pdf",
          pathname: "drive/users/user_123/report-copy.pdf",
          size: 500,
          uploadedAt: new Date("2026-08-20T12:00:00.000Z"),
        },
      ],
      hasMore: false,
      cursor: undefined,
    });
    prismaTaskFileFindManyMock.mockResolvedValue([]);

    const app = createRecentsApp();
    const firstResponse = await app.request("/?scope=me&limit=1&q=report");
    expect(firstResponse.status).toBe(200);

    const firstBody = await firstResponse.json();
    expect(firstBody.data).toHaveLength(1);
    expect(firstBody.data[0].name).toBe("report.pdf");
    expect(firstBody.meta.pagination.nextCursor).toBeTruthy();

    const secondResponse = await app.request(
      `/?scope=me&limit=1&q=report&cursor=${encodeURIComponent(firstBody.meta.pagination.nextCursor)}`,
    );
    expect(secondResponse.status).toBe(200);

    const secondBody = await secondResponse.json();
    expect(secondBody.data).toHaveLength(1);
    expect(secondBody.data[0].name).toBe("report-copy.pdf");
    expect(secondBody.meta.pagination.nextCursor).toBeNull();
  });

  it("keeps global recency order when blob listing spans multiple pages", async () => {
    listMock.mockImplementation(async (options?: { cursor?: string }) => {
      if (options?.cursor === "blob-page-2") {
        return {
          blobs: [
            {
              url: "https://blob.example/newer-report.pdf",
              pathname: "drive/users/user_123/newer-report.pdf",
              size: 500,
              uploadedAt: new Date("2026-08-21T12:00:00.000Z"),
            },
          ],
          hasMore: false,
        };
      }

      return {
        blobs: [
          {
            url: "https://blob.example/older-report.pdf",
            pathname: "drive/users/user_123/older-report.pdf",
            size: 1000,
            uploadedAt: new Date("2026-08-18T12:00:00.000Z"),
          },
        ],
        hasMore: true,
        cursor: "blob-page-2",
      };
    });
    prismaTaskFileFindManyMock.mockResolvedValue([
      {
        id: "tf_mid",
        name: "mid-report.pdf",
        fileUrl: "https://blob.example/mid-report.pdf",
        size: BigInt(500),
        updatedAt: new Date("2026-08-20T12:00:00.000Z"),
        task: {
          id: "task_1",
          name: "Report task",
          projectId: null,
          project: null,
        },
      },
    ]);

    const app = createRecentsApp();
    const response = await app.request("/?scope=me&limit=3&q=report");
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(
      body.data.map((item: { kind: string; name: string }) => item.name),
    ).toEqual(["newer-report.pdf", "mid-report.pdf", "older-report.pdf"]);
  });

  it("flips activityAt with sortBy=date&sortOrder=asc", async () => {
    listMock.mockResolvedValue({
      blobs: [
        {
          url: "https://blob.example/old.pdf",
          pathname: "drive/users/user_123/old.pdf",
          size: 100,
          uploadedAt: new Date("2026-08-18T12:00:00.000Z"),
        },
        {
          url: "https://blob.example/new.pdf",
          pathname: "drive/users/user_123/new.pdf",
          size: 100,
          uploadedAt: new Date("2026-08-21T12:00:00.000Z"),
        },
      ],
      hasMore: false,
    });

    const app = createRecentsApp();
    const response = await app.request(
      "/?scope=me&limit=20&sortBy=date&sortOrder=asc",
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.map((item: { name: string }) => item.name)).toEqual([
      "old.pdf",
      "new.pdf",
    ]);
  });

  it("returns 422 for invalid sortBy", async () => {
    const app = createRecentsApp();
    const response = await app.request("/?scope=me&sortBy=size");
    expect(response.status).toBe(422);
  });
});
