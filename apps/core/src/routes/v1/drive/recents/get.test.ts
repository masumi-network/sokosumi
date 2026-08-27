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
    let blobPage = 0;
    listMock.mockImplementation(async () => {
      blobPage += 1;
      if (blobPage === 1) {
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
      }

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
});
