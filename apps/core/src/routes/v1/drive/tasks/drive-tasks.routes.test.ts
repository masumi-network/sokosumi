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
  prismaBlobFindManyMock,
  prismaBlobFindFirstMock,
  prismaBlobFindUniqueMock,
  prismaBlobCountMock,
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
  prismaBlobFindManyMock: vi.fn(),
  prismaBlobFindFirstMock: vi.fn(),
  prismaBlobFindUniqueMock: vi.fn(),
  prismaBlobCountMock: vi.fn(),
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
    blob: {
      findMany: prismaBlobFindManyMock,
      findFirst: prismaBlobFindFirstMock,
      findUnique: prismaBlobFindUniqueMock,
      count: prismaBlobCountMock,
    },
  },
}));

vi.mock("@/helpers/access-control", () => ({
  requireTaskReadForRouteVars: requireTaskReadForRouteVarsMock,
  requireCoworkerCapability: vi.fn(),
}));

vi.mock("@/helpers/drive-file-access", () => ({
  requireUserDriveFileUploadAccess: requireUserDriveFileUploadAccessMock,
  requireOrganizationDriveFileUploadAccess:
    requireOrganizationDriveFileUploadAccessMock,
}));

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
};

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
        prismaBlobFindManyMock.mockResolvedValue([]);
        prismaTaskFileCountMock.mockResolvedValue(1);
        prismaBlobCountMock.mockResolvedValue(0);

        const app = createDriveTasksApp();
        const res = await app.request(
          "http://localhost/?scope=me&taskId=tsk_123",
        );

        expect(res.status).toBe(200);
        expect(requireTaskReadForRouteVarsMock).toHaveBeenCalled();
      });

      it("lists job output blobs (status READY) sorted by updatedAt desc", async () => {
        requireTaskReadForRouteVarsMock.mockResolvedValue(undefined);

        const blobs = [
          {
            id: "blb_1",
            name: "output.pdf",
            fileUrl: "https://coworker.example/output.pdf",
            sourceUrl: "https://coworker.example/output.pdf",
            size: BigInt(2048),
            mimeType: "application/pdf",
            status: "READY",
            updatedAt: new Date("2026-03-25T14:00:00.000Z"),
          },
        ];

        prismaTaskFileFindManyMock.mockResolvedValue([]);
        prismaBlobFindManyMock.mockResolvedValue(blobs);
        prismaTaskFileCountMock.mockResolvedValue(0);
        prismaBlobCountMock.mockResolvedValue(1);

        const app = createDriveTasksApp();
        const res = await app.request(
          "http://localhost/?scope=me&taskId=tsk_123",
        );

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data).toHaveLength(1);
        expect(json.data[0].type).toBe("job-output");
        expect(json.data[0].id).toBe("blb_1");
      });

      it("combines and sorts TaskFiles and job blobs by updatedAt desc", async () => {
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

        const blobs = [
          {
            id: "blb_1",
            name: "output.pdf",
            fileUrl: "https://coworker.example/output.pdf",
            sourceUrl: "https://coworker.example/output.pdf",
            size: BigInt(2048),
            mimeType: "application/pdf",
            status: "READY",
            updatedAt: new Date("2026-03-25T14:00:00.000Z"),
          },
        ];

        prismaTaskFileFindManyMock.mockResolvedValue(files);
        prismaBlobFindManyMock.mockResolvedValue(blobs);
        prismaTaskFileCountMock.mockResolvedValue(1);
        prismaBlobCountMock.mockResolvedValue(1);

        const app = createDriveTasksApp();
        const res = await app.request(
          "http://localhost/?scope=me&taskId=tsk_123",
        );

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data).toHaveLength(2);
        // Blob is newer, should be first
        expect(json.data[0].type).toBe("job-output");
        expect(json.data[1].type).toBe("task-file");
      });

      it("omits PENDING and FAILED blobs from results", async () => {
        requireTaskReadForRouteVarsMock.mockResolvedValue(undefined);

        // Return empty for READY blobs
        prismaTaskFileFindManyMock.mockResolvedValue([]);
        prismaBlobFindManyMock.mockResolvedValue([]);
        prismaTaskFileCountMock.mockResolvedValue(0);
        prismaBlobCountMock.mockResolvedValue(0);

        const app = createDriveTasksApp();
        const res = await app.request(
          "http://localhost/?scope=me&taskId=tsk_123",
        );

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data).toHaveLength(0);

        // Verify that the blob query filtered by status: READY
        expect(prismaBlobFindManyMock).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              status: "READY",
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
        prismaBlobFindFirstMock.mockResolvedValue(null);

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
        prismaBlobFindFirstMock.mockResolvedValue(null);

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

        const app = createDriveTasksApp();
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
        prismaBlobFindFirstMock.mockResolvedValue(null);

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

        const app = createDriveTasksApp();
        await app.request("http://localhost/?scope=org&organizationId=org_123");

        expect(prismaMemberFindUniqueMock).toHaveBeenCalled();
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
          kind: "task-file",
          taskFileId: "tf_123",
          scope: "me",
        }),
      });

      expect(res.status).toBe(201);
      expect(requireTaskReadForRouteVarsMock).toHaveBeenCalled();
    });

    it("copies job output Blob to Drive root", async () => {
      const blob = {
        id: "blb_123",
        name: "result.pdf",
        fileUrl: "https://coworker.example/output.pdf",
        sourceUrl: "https://coworker.example/source.pdf",
        size: BigInt(2048),
        mimeType: "application/pdf",
        status: "READY",
        event: {
          job: {
            task: { id: "tsk_1" },
          },
        },
      };

      prismaBlobFindUniqueMock.mockResolvedValue(blob);
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

      const arrayBuffer = new ArrayBuffer(2048);
      ssrfSafeFetchMock.mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(arrayBuffer),
      });

      putMock.mockResolvedValue({
        url: "https://blob.example/drive/users/user_123/result.pdf",
        pathname: "drive/users/user_123/result.pdf",
        downloadUrl: "https://blob.example/drive/users/user_123/result.pdf",
        contentType: "application/pdf",
        contentDisposition: "inline",
        etag: "etag456",
      });

      const app = createDriveTasksApp();
      const res = await app.request("http://localhost/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "job-output",
          blobId: "blb_123",
          scope: "me",
        }),
      });

      expect(res.status).toBe(201);
      expect(requireTaskReadForRouteVarsMock).toHaveBeenCalled();
    });

    it("returns 404 when blobId sent with wrong kind (task-file)", async () => {
      prismaTaskFileFindUniqueMock.mockResolvedValue(null);

      const app = createDriveTasksApp();
      const res = await app.request("http://localhost/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "task-file",
          taskFileId: "blb_123", // Blob ID passed as taskFileId
          scope: "me",
        }),
      });

      expect(res.status).toBe(404);
    });

    it("returns 400 when job output Blob is not READY", async () => {
      const blob = {
        id: "blb_123",
        name: "result.pdf",
        fileUrl: "https://coworker.example/output.pdf",
        sourceUrl: "https://coworker.example/source.pdf",
        size: BigInt(2048),
        mimeType: "application/pdf",
        status: "PENDING",
        event: {
          job: {
            task: { id: "tsk_1" },
          },
        },
      };

      prismaBlobFindUniqueMock.mockResolvedValue(blob);

      const app = createDriveTasksApp();
      const res = await app.request("http://localhost/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "job-output",
          blobId: "blb_123",
          scope: "me",
        }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 409 when dest file exists", async () => {
      const taskFile = {
        id: "tf_123",
        name: "document.pdf",
        fileUrl: "https://blob.example/tasks/tsk_1/document.pdf",
        size: BigInt(1024),
        mimeType: "application/pdf",
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
          kind: "task-file",
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
