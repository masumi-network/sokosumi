import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import mountGet from "./get";

const {
  workspaceRepositoryMock,
  prismaTaskFileFindManyMock,
  prismaTaskFileFindFirstMock,
  prismaTaskFileCountMock,
  prismaTaskFindManyMock,
  prismaTaskCountMock,
  prismaProjectFindManyMock,
  prismaMemberFindUniqueMock,
  requireTaskReadForRouteVarsMock,
} = vi.hoisted(() => ({
  workspaceRepositoryMock: {
    resolveWorkspaceForContext: vi.fn(),
  },
  prismaTaskFileFindManyMock: vi.fn(),
  prismaTaskFileFindFirstMock: vi.fn(),
  prismaTaskFileCountMock: vi.fn(),
  prismaTaskFindManyMock: vi.fn(),
  prismaTaskCountMock: vi.fn(),
  prismaProjectFindManyMock: vi.fn(),
  prismaMemberFindUniqueMock: vi.fn(),
  requireTaskReadForRouteVarsMock: vi.fn(),
}));

vi.mock("@sokosumi/database/repositories", () => ({
  workspaceRepository: workspaceRepositoryMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    taskFile: {
      findMany: prismaTaskFileFindManyMock,
      findFirst: prismaTaskFileFindFirstMock,
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

vi.mock("@/helpers/vendor-grants", () => ({
  hasGrantedWorkspaceAccess: vi.fn().mockResolvedValue(false),
  buildCoworkerTaskListAccessFilter: vi.fn().mockReturnValue({}),
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const _ORG_USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: "org_123",
  role: "user",
};

function createApp(authContext: AuthenticationContext = USER_AUTH_CONTEXT) {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("requestId", "req_123");
    await next();
  });

  mountGet(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

describe("GET /v1/drive/tasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspaceRepositoryMock.resolveWorkspaceForContext.mockResolvedValue({
      id: "ws_personal",
    });
  });

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
        {
          id: "tf_2",
          name: "file2.txt",
          fileUrl: "https://example.com/file2.txt",
          size: BigInt(2048),
          mimeType: "text/plain",
          updatedAt: new Date("2026-03-25T11:00:00.000Z"),
        },
      ];

      prismaTaskFileFindManyMock.mockResolvedValue(files);
      prismaTaskFileCountMock.mockResolvedValue(2);

      const app = createApp();
      const res = await app.request(
        "http://localhost/?scope=me&taskId=tsk_123",
      );

      expect(res.status).toBe(200);
      expect(requireTaskReadForRouteVarsMock).toHaveBeenCalledWith(
        expect.anything(),
        "tsk_123",
      );

      const json = await res.json();
      expect(json.data).toHaveLength(2);
      expect(json.data[0]).toMatchObject({
        type: "task-file",
        id: "tf_1",
        name: "file1.txt",
      });
    });
  });

  describe("Level 2: Task rows", () => {
    it("lists tasks with files sorted by latest file updatedAt desc", async () => {
      const tasks = [
        {
          id: "tsk_1",
          name: "Task 1",
          files: [{ updatedAt: new Date("2026-03-25T12:00:00.000Z") }],
        },
        {
          id: "tsk_2",
          name: "Task 2",
          files: [{ updatedAt: new Date("2026-03-25T10:00:00.000Z") }],
        },
      ];

      prismaTaskFindManyMock.mockResolvedValue(tasks);
      prismaTaskCountMock.mockResolvedValue(2);

      const app = createApp();
      const res = await app.request(
        "http://localhost/?scope=me&projectId=prj_123",
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(2);
      expect(json.data[0]).toMatchObject({
        type: "task",
        id: "tsk_1",
        name: "Task 1",
      });
      // Sorted by latest file updatedAt desc
      expect(json.data[0].latestFileUpdatedAt).toBe("2026-03-25T12:00:00.000Z");
    });

    it("handles projectId=null for no-project tasks", async () => {
      prismaTaskFindManyMock.mockResolvedValue([]);
      prismaTaskCountMock.mockResolvedValue(0);

      const app = createApp();
      const res = await app.request(
        "http://localhost/?scope=me&projectId=null",
      );

      expect(res.status).toBe(200);
      expect(prismaTaskFindManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            projectId: null,
          }),
        }),
      );
    });

    it("includes assigneeId in task where clause", async () => {
      prismaTaskFindManyMock.mockResolvedValue([]);
      prismaTaskCountMock.mockResolvedValue(0);

      const app = createApp();
      const res = await app.request(
        "http://localhost/?scope=me&projectId=prj_123&assigneeId=cow_456",
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

    it("filters by archivedAt: null and files: { some: {} }", async () => {
      prismaTaskFindManyMock.mockResolvedValue([]);
      prismaTaskCountMock.mockResolvedValue(0);

      const app = createApp();
      await app.request("http://localhost/?scope=me&projectId=prj_123");

      expect(prismaTaskFindManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            archivedAt: null,
            files: { some: {} },
          }),
        }),
      );
    });
  });

  describe("Level 1: Project rows + no-project", () => {
    it("lists projects and no-project sorted by latest file updatedAt desc", async () => {
      const projects = [
        {
          id: "prj_1",
          name: "Project 1",
          tasks: [
            {
              files: [{ updatedAt: new Date("2026-03-25T14:00:00.000Z") }],
            },
          ],
        },
        {
          id: "prj_2",
          name: "Project 2",
          tasks: [
            {
              files: [{ updatedAt: new Date("2026-03-25T10:00:00.000Z") }],
            },
          ],
        },
      ];

      prismaProjectFindManyMock.mockResolvedValue(projects);
      prismaTaskCountMock.mockResolvedValue(1); // no-project tasks exist
      prismaTaskFileFindFirstMock.mockResolvedValue({
        updatedAt: new Date("2026-03-25T12:00:00.000Z"),
      });

      const app = createApp();
      const res = await app.request("http://localhost/?scope=me");

      expect(res.status).toBe(200);
      const json = await res.json();

      // Should have 3 items: 2 projects + 1 no-project, sorted by file time
      expect(json.data).toHaveLength(3);
      expect(json.data[0].type).toBe("project");
      expect(json.data[0].id).toBe("prj_1");
      expect(json.data[1].type).toBe("no-project");
      expect(json.data[2].type).toBe("project");
      expect(json.data[2].id).toBe("prj_2");
    });

    it("paginates combined project + no-project list correctly", async () => {
      const projects = [
        {
          id: "prj_1",
          name: "Project 1",
          tasks: [
            {
              files: [{ updatedAt: new Date("2026-03-25T14:00:00.000Z") }],
            },
          ],
        },
      ];

      prismaProjectFindManyMock.mockResolvedValue(projects);
      prismaTaskCountMock.mockResolvedValue(1);
      prismaTaskFileFindFirstMock.mockResolvedValue({
        updatedAt: new Date("2026-03-25T12:00:00.000Z"),
      });

      const app = createApp();
      const res = await app.request("http://localhost/?scope=me&limit=1");

      expect(res.status).toBe(200);
      const json = await res.json();

      // Should have 1 item (limited), not overflow with no-project
      expect(json.data).toHaveLength(1);
      expect(json.pagination.hasMore).toBe(true);
    });

    it("omits no-project row when no unscoped tasks have files", async () => {
      const projects = [
        {
          id: "prj_1",
          name: "Project 1",
          tasks: [
            {
              files: [{ updatedAt: new Date("2026-03-25T14:00:00.000Z") }],
            },
          ],
        },
      ];

      prismaProjectFindManyMock.mockResolvedValue(projects);
      prismaTaskCountMock.mockResolvedValue(0); // no no-project tasks

      const app = createApp();
      const res = await app.request("http://localhost/?scope=me");

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(1);
      expect(json.data[0].type).toBe("project");
    });
  });

  describe("ACL", () => {
    it("requires scope parameter", async () => {
      const app = createApp();
      const res = await app.request("http://localhost/");

      expect(res.status).toBe(400);
    });

    it("requires organizationId when scope=org", async () => {
      const app = createApp();
      const res = await app.request("http://localhost/?scope=org");

      expect(res.status).toBe(400);
    });

    it("resolves personal workspace for scope=me", async () => {
      prismaProjectFindManyMock.mockResolvedValue([]);
      prismaTaskCountMock.mockResolvedValue(0);

      const app = createApp();
      await app.request("http://localhost/?scope=me");

      expect(
        workspaceRepositoryMock.resolveWorkspaceForContext,
      ).toHaveBeenCalledWith("user_123", null, expect.anything());
    });

    it("resolves org workspace for scope=org", async () => {
      prismaMemberFindUniqueMock.mockResolvedValue({
        userId: "user_123",
        organizationId: "org_123",
      });
      workspaceRepositoryMock.resolveWorkspaceForContext.mockResolvedValue({
        id: "ws_org",
      });
      prismaProjectFindManyMock.mockResolvedValue([]);
      prismaTaskCountMock.mockResolvedValue(0);

      const app = createApp();
      await app.request("http://localhost/?scope=org&organizationId=org_123");

      expect(prismaMemberFindUniqueMock).toHaveBeenCalledWith({
        where: {
          userId_organizationId: {
            userId: "user_123",
            organizationId: "org_123",
          },
        },
      });
      expect(
        workspaceRepositoryMock.resolveWorkspaceForContext,
      ).toHaveBeenCalledWith("user_123", "org_123", expect.anything());
    });

    it("returns 403 when not a member of the organization", async () => {
      prismaMemberFindUniqueMock.mockResolvedValue(null);

      const app = createApp();
      const res = await app.request(
        "http://localhost/?scope=org&organizationId=org_999",
      );

      expect(res.status).toBe(403);
    });
  });
});
