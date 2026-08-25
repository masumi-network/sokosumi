import { OpenAPIHono } from "@hono/zod-openapi";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import mountPostFolder from "../folders/post";
import mountCopy from "./copy";
import mountGet from "./get";

const {
  workspaceRepositoryMock,
  prismaTaskFileFindManyMock,
  prismaTaskFileFindFirstMock,
  prismaTaskFileFindUniqueMock,
  prismaTaskFileCountMock,
  prismaTaskFindManyMock,
  prismaTaskCountMock,
  prismaProjectFindManyMock,
  prismaMemberFindUniqueMock,
  requireTaskReadForRouteVarsMock,
  requireUserDriveFileUploadAccessMock,
  requireOrganizationDriveFileUploadAccessMock,
  ssrfSafeFetchMock,
  headMock,
  listMock,
  putMock,
} = vi.hoisted(() => ({
  workspaceRepositoryMock: {
    resolveWorkspaceForContext: vi.fn(),
  },
  prismaTaskFileFindManyMock: vi.fn(),
  prismaTaskFileFindFirstMock: vi.fn(),
  prismaTaskFileFindUniqueMock: vi.fn(),
  prismaTaskFileCountMock: vi.fn(),
  prismaTaskFindManyMock: vi.fn(),
  prismaTaskCountMock: vi.fn(),
  prismaProjectFindManyMock: vi.fn(),
  prismaMemberFindUniqueMock: vi.fn(),
  requireTaskReadForRouteVarsMock: vi.fn(),
  requireUserDriveFileUploadAccessMock: vi.fn(),
  requireOrganizationDriveFileUploadAccessMock: vi.fn(),
  ssrfSafeFetchMock: vi.fn(),
  headMock: vi.fn(),
  listMock: vi.fn(),
  putMock: vi.fn(),
}));

vi.mock("@sokosumi/database/repositories", () => ({
  workspaceRepository: workspaceRepositoryMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    taskFile: {
      findMany: prismaTaskFileFindManyMock,
      findFirst: prismaTaskFileFindFirstMock,
      findUnique: prismaTaskFileFindUniqueMock,
      count: prismaTaskFileCountMock,
    },
    task: {
      findMany: prismaTaskFindManyMock,
      count: prismaTaskCountMock,
    },
    project: {
      findMany: prismaProjectFindManyMock,
    },
    member: {
      findUnique: prismaMemberFindUniqueMock,
    },
  },
}));

vi.mock("@/helpers/access-control", () => ({
  requireTaskReadForRouteVars: requireTaskReadForRouteVarsMock,
  requireCoworkerCapability: vi.fn(),
}));

vi.mock("@/helpers/drive-file-access", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/helpers/drive-file-access")>();
  return {
    ...actual,
    requireUserDriveFileUploadAccess: requireUserDriveFileUploadAccessMock,
    requireOrganizationDriveFileUploadAccess:
      requireOrganizationDriveFileUploadAccessMock,
  };
});

vi.mock("@/helpers/vendor-grants", () => ({
  hasGrantedWorkspaceAccess: vi.fn().mockResolvedValue(false),
  buildCoworkerTaskListAccessFilter: vi.fn().mockReturnValue({}),
}));

vi.mock("@sokosumi/net", () => ({
  ssrfSafeFetch: ssrfSafeFetchMock,
}));

vi.mock("@vercel/blob", () => ({
  head: headMock,
  list: listMock,
  put: putMock,
  BlobNotFoundError: class BlobNotFoundError extends Error {},
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

const ORG_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: "org_123",
  role: "user",
  authenticationMethod: "session",
};

const COWORKER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_123",
  vendorId: "ven_123",
  context: {
    userId: "user_123",
    organizationId: null,
  },
};

const BARE_COWORKER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_123",
  vendorId: "ven_123",
};

const DRIVE_TASK_FILE_WHERE = {
  status: "READY",
  origin: "TASK_OUTPUT",
  fileUrl: { not: null },
} as const;

function createDriveTasksApp(
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
  mountCopy(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

function createFoldersApp(
  authContext: AuthenticationContext = USER_AUTH_CONTEXT,
) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & RequestIdVariables;
  }>();

  app.onError(errorHandler);

  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    await next();
  });

  mountPostFolder(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

describe("Drive Tasks Routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspaceRepositoryMock.resolveWorkspaceForContext.mockResolvedValue({
      id: "ws_personal",
      userId: "user_123",
      organizationId: null,
    });
  });

  describe("GET /v1/drive/tasks - List", () => {
    describe("Level 3: TaskFile rows", () => {
      it("lists task files sorted by updatedAt desc", async () => {
        requireTaskReadForRouteVarsMock.mockResolvedValue(undefined);

        const files = [
          {
            id: "tf_1",
            name: "file1.txt",
            fileUrl: "https://example.com/file1.txt",
            size: BigInt(1024),
            mimeType: "text/plain",
            updatedAt: new Date("2026-03-25T12:00:00.000Z"),
          },
        ];

        prismaTaskFileFindManyMock.mockResolvedValue(files);
        prismaTaskFileCountMock.mockResolvedValue(1);

        const app = createDriveTasksApp();
        const res = await app.request(
          "http://localhost/?scope=me&taskId=tsk_123",
        );

        expect(res.status).toBe(200);
        expect(requireTaskReadForRouteVarsMock).toHaveBeenCalledWith(
          expect.objectContaining({
            workspaceContext: {
              workspaceId: "ws_personal",
              userId: "user_123",
              organizationId: null,
            },
          }),
          "tsk_123",
        );
      });

      it("omits PENDING and FAILED TaskFiles from results", async () => {
        requireTaskReadForRouteVarsMock.mockResolvedValue(undefined);

        // Return empty for READY TaskFiles
        prismaTaskFileFindManyMock.mockResolvedValue([]);
        prismaTaskFileCountMock.mockResolvedValue(0);

        const app = createDriveTasksApp();
        const res = await app.request(
          "http://localhost/?scope=me&taskId=tsk_123",
        );

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data).toHaveLength(0);

        // Verify that the TaskFile query filtered by status: READY and non-null fileUrl
        expect(prismaTaskFileFindManyMock).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining(DRIVE_TASK_FILE_WHERE),
          }),
        );
      });

      it("omits TaskFiles with null fileUrl from results", async () => {
        requireTaskReadForRouteVarsMock.mockResolvedValue(undefined);

        prismaTaskFileFindManyMock.mockResolvedValue([]);
        prismaTaskFileCountMock.mockResolvedValue(0);

        const app = createDriveTasksApp();
        const res = await app.request(
          "http://localhost/?scope=me&taskId=tsk_123",
        );

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data).toHaveLength(0);

        // Verify fileUrl null check
        expect(prismaTaskFileFindManyMock).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              fileUrl: { not: null },
            }),
          }),
        );
      });

      it("returns task-file item for READY TaskFile with fileUrl that Level 2 showed", async () => {
        // Regression test: Level 2 must show task if it has READY files with fileUrl
        // Then Level 3 must return those same task-file items
        requireTaskReadForRouteVarsMock.mockResolvedValue(undefined);

        const taskId = "01a019d9-cda2-76f8-902a-d8ce5250ea6f";
        const readyFile = {
          id: "tf_ready",
          name: "booth.pdf",
          fileUrl: "https://example.com/booth.pdf",
          size: BigInt(2048),
          mimeType: "application/pdf",
          status: "READY",
          updatedAt: new Date("2026-08-24T12:00:00.000Z"),
        };

        // Level 3: returns the READY file
        prismaTaskFileFindManyMock.mockResolvedValue([readyFile]);
        prismaTaskFileCountMock.mockResolvedValue(1);

        const app = createDriveTasksApp();
        const res = await app.request(
          `http://localhost/?scope=me&taskId=${taskId}`,
        );

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data).toHaveLength(1);
        expect(json.data[0]).toMatchObject({
          type: "task-file",
          id: "tf_ready",
          name: "booth.pdf",
          fileUrl: "https://example.com/booth.pdf",
        });

        // Verify Level 3 query uses direct taskId filter (not nested task join)
        expect(prismaTaskFileFindManyMock).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              taskId,
              ...DRIVE_TASK_FILE_WHERE,
            },
          }),
        );
      });
    });

    describe("Search: task-file rows", () => {
      it("searches by task name, description, and file name", async () => {
        const matchingFile = {
          id: "tf_search",
          name: "mockup.pdf",
          fileUrl: "https://example.com/mockup.pdf",
          size: BigInt(1024),
          mimeType: "application/pdf",
          updatedAt: new Date("2026-08-24T12:00:00.000Z"),
          task: {
            id: "tsk_search",
            name: "Design mockups",
            projectId: "prj_search",
            project: { name: "Q4 Campaign" },
          },
        };

        prismaTaskFileFindManyMock.mockResolvedValue([matchingFile]);
        prismaTaskFileCountMock.mockResolvedValue(1);

        const app = createDriveTasksApp();
        const res = await app.request("http://localhost/?scope=me&q=mockup");

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data).toHaveLength(1);
        expect(json.data[0]).toMatchObject({
          type: "task-file",
          id: "tf_search",
          name: "mockup.pdf",
          taskId: "tsk_search",
          taskName: "Design mockups",
          projectId: "prj_search",
          projectName: "Q4 Campaign",
        });
        expect(prismaTaskFileFindManyMock).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              OR: expect.arrayContaining([
                expect.objectContaining({
                  name: { contains: "mockup", mode: "insensitive" },
                }),
              ]),
            }),
          }),
        );
      });
    });

    describe("Level 2: Task rows", () => {
      it("lists tasks sorted by latest file updatedAt desc", async () => {
        const tasks = [
          {
            id: "tsk_1",
            name: "Task 1",
            files: [{ updatedAt: new Date("2026-03-25T12:00:00.000Z") }],
            jobs: [],
          },
        ];

        prismaTaskFindManyMock.mockResolvedValue(tasks);
        prismaTaskCountMock.mockResolvedValue(1);

        const app = createDriveTasksApp();
        const res = await app.request(
          "http://localhost/?scope=me&projectId=550e8400-e29b-41d4-a716-446655440000",
        );

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data).toHaveLength(1);
        expect(json.data[0].type).toBe("task");
      });

      it("includes assigneeId in task where clause", async () => {
        prismaTaskFindManyMock.mockResolvedValue([]);
        prismaTaskCountMock.mockResolvedValue(0);

        const app = createDriveTasksApp();
        const res = await app.request(
          "http://localhost/?scope=me&projectId=550e8400-e29b-41d4-a716-446655440000&assigneeId=cow_456",
        );

        expect(res.status).toBe(200);
        expect(prismaTaskFindManyMock).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              assigneeId: "cow_456",
            }),
          }),
        );
      });

      it("excludes tasks with only PENDING/FAILED TaskFiles", async () => {
        // Mock task query to check the where clause includes READY file filter
        prismaTaskFindManyMock.mockResolvedValue([]);
        prismaTaskCountMock.mockResolvedValue(0);

        const app = createDriveTasksApp();
        const res = await app.request(
          "http://localhost/?scope=me&projectId=550e8400-e29b-41d4-a716-446655440000",
        );

        expect(res.status).toBe(200);
        // Verify that the base task where clause includes READY file filter
        expect(prismaTaskFindManyMock).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              files: {
                some: DRIVE_TASK_FILE_WHERE,
              },
            }),
          }),
        );
      });

      it("excludes tasks with only USER_UPLOAD TaskFiles", async () => {
        prismaTaskFindManyMock.mockResolvedValue([]);
        prismaTaskCountMock.mockResolvedValue(0);

        const app = createDriveTasksApp();
        const res = await app.request(
          "http://localhost/?scope=me&projectId=550e8400-e29b-41d4-a716-446655440000",
        );

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data).toHaveLength(0);

        expect(prismaTaskFindManyMock).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              files: {
                some: DRIVE_TASK_FILE_WHERE,
              },
            }),
          }),
        );
      });
    });

    describe("Level 1: Project + no-project rows", () => {
      it("lists projects and no-project sorted by latest file updatedAt", async () => {
        const projects = [
          {
            id: "prj_1",
            name: "Project 1",
            tasks: [
              {
                files: [{ updatedAt: new Date("2026-03-25T14:00:00.000Z") }],
                jobs: [],
              },
            ],
          },
        ];

        prismaTaskFindManyMock.mockResolvedValue([{ projectId: "prj_1" }]);
        prismaProjectFindManyMock.mockResolvedValue(projects);
        prismaTaskCountMock.mockResolvedValue(1);
        prismaTaskFileFindFirstMock.mockResolvedValue({
          updatedAt: new Date("2026-03-25T12:00:00.000Z"),
        });

        const app = createDriveTasksApp();
        const res = await app.request("http://localhost/?scope=me");

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data.length).toBeGreaterThan(0);
      });

      it("paginates combined list correctly", async () => {
        const projects = [
          {
            id: "prj_1",
            name: "Project 1",
            tasks: [
              {
                files: [{ updatedAt: new Date("2026-03-25T14:00:00.000Z") }],
                jobs: [],
              },
            ],
          },
        ];

        prismaTaskFindManyMock.mockResolvedValue([{ projectId: "prj_1" }]);
        prismaProjectFindManyMock.mockResolvedValue(projects);
        prismaTaskCountMock.mockResolvedValue(1);
        prismaTaskFileFindFirstMock.mockResolvedValue({
          updatedAt: new Date("2026-03-25T12:00:00.000Z"),
        });

        const app = createDriveTasksApp();
        const res = await app.request("http://localhost/?scope=me&limit=1");

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data).toHaveLength(1);
      });

      it("shows transferred task project (Task.workspaceId matches, Project.workspaceId does not)", async () => {
        // Simulate transferred task: Task.workspaceId = ws_org, Project.workspaceId = ws_personal
        workspaceRepositoryMock.resolveWorkspaceForContext.mockResolvedValue({
          id: "ws_org",
          userId: null,
          organizationId: "org_123",
        });
        prismaMemberFindUniqueMock.mockResolvedValue({
          userId: "user_123",
          organizationId: "org_123",
        });

        // Task with projectId pointing to a project whose workspaceId is different
        prismaTaskFindManyMock.mockResolvedValue([
          { projectId: "prj_transferred" },
        ]);

        const projectFromDifferentWorkspace = {
          id: "prj_transferred",
          name: "Transferred Project",
          workspaceId: "ws_personal", // Different from Drive workspace
          tasks: [
            {
              files: [{ updatedAt: new Date("2026-03-25T15:00:00.000Z") }],
              jobs: [],
            },
          ],
        };

        prismaProjectFindManyMock.mockResolvedValue([
          projectFromDifferentWorkspace,
        ]);
        prismaTaskCountMock.mockResolvedValue(0); // No no-project tasks

        const app = createDriveTasksApp(ORG_AUTH_CONTEXT);
        const res = await app.request(
          "http://localhost/?scope=org&organizationId=org_123",
        );

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data).toHaveLength(1);
        expect(json.data[0]).toMatchObject({
          type: "project",
          id: "prj_transferred",
          name: "Transferred Project",
        });

        // Assert distinct is NOT used (relation filter + distinct can throw)
        expect(prismaTaskFindManyMock).toHaveBeenCalledWith(
          expect.not.objectContaining({
            distinct: expect.anything(),
          }),
        );
      });

      it("shows fallback name when project row is missing but tasks exist", async () => {
        // Task references a projectId but the Project row was deleted
        prismaTaskFindManyMock.mockResolvedValue([
          { projectId: "prj_deleted" },
        ]);

        // Project row not found
        prismaProjectFindManyMock.mockResolvedValue([]);
        prismaTaskCountMock.mockResolvedValue(0);

        const app = createDriveTasksApp();
        const res = await app.request("http://localhost/?scope=me");

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data).toHaveLength(1);
        expect(json.data[0]).toMatchObject({
          type: "project",
          id: "prj_deleted",
          name: expect.stringContaining("[Project"),
        });
      });

      it("includes no-project row when tasks with projectId: null have files", async () => {
        prismaTaskFindManyMock.mockResolvedValue([]); // No project tasks
        prismaProjectFindManyMock.mockResolvedValue([]);
        prismaTaskCountMock.mockResolvedValue(1); // One no-project task
        prismaTaskFileFindFirstMock.mockResolvedValue({
          updatedAt: new Date("2026-03-25T12:00:00.000Z"),
        });

        const app = createDriveTasksApp();
        const res = await app.request("http://localhost/?scope=me");

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data).toHaveLength(1);
        expect(json.data[0]).toMatchObject({
          type: "no-project",
          id: "null",
        });
      });
    });

    describe("ACL", () => {
      it("requires scope parameter", async () => {
        const app = createDriveTasksApp();
        const res = await app.request("http://localhost/");

        expect(res.status).toBe(400);
      });

      it("resolves org workspace for scope=org", async () => {
        prismaMemberFindUniqueMock.mockResolvedValue({
          userId: "user_123",
          organizationId: "org_123",
        });
        prismaProjectFindManyMock.mockResolvedValue([]);
        prismaTaskCountMock.mockResolvedValue(0);

        const app = createDriveTasksApp(ORG_AUTH_CONTEXT);
        await app.request("http://localhost/?scope=org&organizationId=org_123");

        expect(prismaMemberFindUniqueMock).toHaveBeenCalled();
      });

      it("rejects scope=me from an organization workspace", async () => {
        const app = createDriveTasksApp(ORG_AUTH_CONTEXT);
        const res = await app.request("http://localhost/?scope=me");

        expect(res.status).toBe(403);
        const json = await res.json();
        expect(json.error?.message ?? json.message).toContain(
          "My Drive is only available in a personal workspace",
        );
      });

      it("rejects scope=org from a personal workspace", async () => {
        const app = createDriveTasksApp();
        const res = await app.request(
          "http://localhost/?scope=org&organizationId=org_123",
        );

        expect(res.status).toBe(403);
        const json = await res.json();
        expect(json.error?.message ?? json.message).toContain(
          "Organization Drive is only available in an organization workspace",
        );
      });

      it("lists for a coworker with workspace context", async () => {
        prismaTaskFindManyMock.mockResolvedValue([]);
        prismaProjectFindManyMock.mockResolvedValue([]);
        prismaTaskCountMock.mockResolvedValue(0);

        const app = createDriveTasksApp(COWORKER_AUTH_CONTEXT);
        const res = await app.request("http://localhost/?scope=me");

        expect(res.status).toBe(200);
        expect(
          workspaceRepositoryMock.resolveWorkspaceForContext,
        ).toHaveBeenCalledWith("user_123", null, expect.anything());
      });

      it("rejects a coworker without workspace context", async () => {
        const app = createDriveTasksApp(BARE_COWORKER_AUTH_CONTEXT);
        const res = await app.request("http://localhost/?scope=me");

        expect(res.status).toBe(403);
        const json = await res.json();
        expect(json.error?.message ?? json.message).toContain(
          "Drive Tasks requires workspace context",
        );
      });
    });
  });

  describe("POST /v1/drive/tasks/copy", () => {
    it("copies TaskFile to Drive root", async () => {
      const taskFile = {
        id: "tf_123",
        name: "document.pdf",
        fileUrl: "https://blob.example/tasks/tsk_1/document.pdf",
        size: BigInt(1024),
        mimeType: "application/pdf",
        status: "READY",
        origin: "TASK_OUTPUT",
        task: { id: "tsk_1" },
      };

      prismaTaskFileFindUniqueMock.mockResolvedValue(taskFile);
      requireTaskReadForRouteVarsMock.mockResolvedValue(undefined);
      requireUserDriveFileUploadAccessMock.mockResolvedValue(undefined);

      const BlobNotFoundError = (await import("@vercel/blob"))
        .BlobNotFoundError;
      headMock.mockRejectedValue(new BlobNotFoundError());
      listMock.mockResolvedValue({
        blobs: [],
        hasMore: false,
        cursor: undefined,
      });

      const arrayBuffer = new ArrayBuffer(1024);
      ssrfSafeFetchMock.mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(arrayBuffer),
      });

      putMock.mockResolvedValue({
        url: "https://blob.example/drive/users/user_123/document.pdf",
        pathname: "drive/users/user_123/document.pdf",
        downloadUrl: "https://blob.example/drive/users/user_123/document.pdf",
        contentType: "application/pdf",
        contentDisposition: "inline",
        etag: "etag123",
      });

      const app = createDriveTasksApp();
      const res = await app.request("http://localhost/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskFileId: "tf_123",
          scope: "me",
        }),
      });

      expect(res.status).toBe(201);
      expect(requireTaskReadForRouteVarsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceContext: {
            workspaceId: "ws_personal",
            userId: "user_123",
            organizationId: null,
          },
        }),
        "tsk_1",
      );
    });

    it("returns 404 when TaskFile not found", async () => {
      prismaTaskFileFindUniqueMock.mockResolvedValue(null);

      const app = createDriveTasksApp();
      const res = await app.request("http://localhost/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskFileId: "tf_999",
          scope: "me",
        }),
      });

      expect(res.status).toBe(404);
    });

    it("returns 400 when TaskFile is PENDING", async () => {
      const taskFile = {
        id: "tf_123",
        name: "document.pdf",
        fileUrl: "https://blob.example/tasks/tsk_1/document.pdf",
        size: BigInt(1024),
        mimeType: "application/pdf",
        status: "PENDING",
        origin: "TASK_OUTPUT",
        task: { id: "tsk_1" },
      };

      prismaTaskFileFindUniqueMock.mockResolvedValue(taskFile);

      const app = createDriveTasksApp();
      const res = await app.request("http://localhost/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskFileId: "tf_123",
          scope: "me",
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error?.message ?? json.message).toContain("PENDING");
    });

    it("returns 400 when TaskFile is FAILED", async () => {
      const taskFile = {
        id: "tf_123",
        name: "document.pdf",
        fileUrl: "https://blob.example/tasks/tsk_1/document.pdf",
        size: BigInt(1024),
        mimeType: "application/pdf",
        status: "FAILED",
        origin: "TASK_OUTPUT",
        task: { id: "tsk_1" },
      };

      prismaTaskFileFindUniqueMock.mockResolvedValue(taskFile);

      const app = createDriveTasksApp();
      const res = await app.request("http://localhost/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskFileId: "tf_123",
          scope: "me",
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error?.message ?? json.message).toContain("FAILED");
    });

    it("returns 400 when TaskFile is USER_UPLOAD", async () => {
      const taskFile = {
        id: "tf_123",
        name: "document.pdf",
        fileUrl: "https://blob.example/tasks/tsk_1/document.pdf",
        size: BigInt(1024),
        mimeType: "application/pdf",
        status: "READY",
        origin: "USER_UPLOAD",
        task: { id: "tsk_1" },
      };

      prismaTaskFileFindUniqueMock.mockResolvedValue(taskFile);

      const app = createDriveTasksApp();
      const res = await app.request("http://localhost/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskFileId: "tf_123",
          scope: "me",
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error?.message ?? json.message).toContain("user-uploaded");
    });

    it("returns 400 when TaskFile has null fileUrl", async () => {
      const taskFile = {
        id: "tf_123",
        name: "document.pdf",
        fileUrl: null,
        size: BigInt(1024),
        mimeType: "application/pdf",
        status: "READY",
        origin: "TASK_OUTPUT",
        task: { id: "tsk_1" },
      };

      prismaTaskFileFindUniqueMock.mockResolvedValue(taskFile);

      const app = createDriveTasksApp();
      const res = await app.request("http://localhost/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskFileId: "tf_123",
          scope: "me",
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error?.message ?? json.message).toContain("file URL");
    });

    it("returns 409 when dest file exists", async () => {
      const taskFile = {
        id: "tf_123",
        name: "document.pdf",
        fileUrl: "https://blob.example/tasks/tsk_1/document.pdf",
        size: BigInt(1024),
        mimeType: "application/pdf",
        status: "READY",
        origin: "TASK_OUTPUT",
        task: { id: "tsk_1" },
      };

      prismaTaskFileFindUniqueMock.mockResolvedValue(taskFile);
      requireTaskReadForRouteVarsMock.mockResolvedValue(undefined);
      requireUserDriveFileUploadAccessMock.mockResolvedValue(undefined);

      headMock.mockResolvedValue({
        url: "https://blob.example/drive/users/user_123/document.pdf",
        size: 1024,
        uploadedAt: new Date(),
        pathname: "drive/users/user_123/document.pdf",
        contentType: "application/pdf",
        contentDisposition: "inline",
      });

      const app = createDriveTasksApp();
      const res = await app.request("http://localhost/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskFileId: "tf_123",
          scope: "me",
        }),
      });

      expect(res.status).toBe(409);
    });
  });

  describe("POST /v1/drive/folders - Reserved 'Tasks' name", () => {
    it("rejects 'Tasks' as root folder name", async () => {
      requireUserDriveFileUploadAccessMock.mockResolvedValue(undefined);

      const app = createFoldersApp();
      const res = await app.request("http://localhost/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folderPath: "Tasks",
          scope: "me",
        }),
      });

      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error?.message || json.message).toContain("reserved");
    });

    it("rejects 'Tasks' nested in path (root segment check)", async () => {
      requireUserDriveFileUploadAccessMock.mockResolvedValue(undefined);

      const app = createFoldersApp();
      const res = await app.request("http://localhost/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folderPath: "Tasks/SubFolder",
          scope: "me",
        }),
      });

      expect(res.status).toBe(409);
    });

    it("allows 'Tasks' as non-root segment", async () => {
      requireUserDriveFileUploadAccessMock.mockResolvedValue(undefined);

      const BlobNotFoundError = (await import("@vercel/blob"))
        .BlobNotFoundError;
      headMock.mockRejectedValue(new BlobNotFoundError());
      listMock.mockResolvedValue({
        blobs: [],
        hasMore: false,
        cursor: undefined,
      });
      putMock.mockResolvedValue({
        url: "https://example.com/drive/users/user_123/Projects/Tasks/__drive_folder__",
        pathname: "drive/users/user_123/Projects/Tasks/__drive_folder__",
        downloadUrl:
          "https://example.com/drive/users/user_123/Projects/Tasks/__drive_folder__",
        contentType: "application/octet-stream",
        contentDisposition: "inline",
        etag: "etag123",
      });

      const app = createFoldersApp();
      const res = await app.request("http://localhost/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folderPath: "Projects/Tasks",
          scope: "me",
        }),
      });

      expect(res.status).toBe(201);
    });

    it("allows folder names other than 'Tasks'", async () => {
      requireUserDriveFileUploadAccessMock.mockResolvedValue(undefined);

      const BlobNotFoundError = (await import("@vercel/blob"))
        .BlobNotFoundError;
      headMock.mockRejectedValue(new BlobNotFoundError());
      listMock.mockResolvedValue({
        blobs: [],
        hasMore: false,
        cursor: undefined,
      });
      putMock.mockResolvedValue({
        url: "https://example.com/drive/users/user_123/Documents/__drive_folder__",
        pathname: "drive/users/user_123/Documents/__drive_folder__",
        downloadUrl:
          "https://example.com/drive/users/user_123/Documents/__drive_folder__",
        contentType: "application/octet-stream",
        contentDisposition: "inline",
        etag: "etag123",
      });

      const app = createFoldersApp();
      const res = await app.request("http://localhost/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folderPath: "Documents",
          scope: "me",
        }),
      });

      expect(res.status).toBe(201);
    });
  });
});
