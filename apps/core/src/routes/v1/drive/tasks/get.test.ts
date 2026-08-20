import { beforeEach, describe, expect, it, vi } from "vitest";

import mountGet from "./get";

// Mock Prisma
const mockPrismaClient = {
  taskFile: {
    findMany: vi.fn(),
    count: vi.fn(),
    findFirst: vi.fn(),
  },
  task: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
  project: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
  workspace: {
    findUnique: vi.fn(),
  },
  member: {
    findUnique: vi.fn(),
  },
};

vi.mock("@/lib/db/prisma", () => ({
  default: mockPrismaClient,
}));

// Mock access control
vi.mock("@/helpers/access-control", () => ({
  requireTaskReadForRouteVars: vi.fn(),
}));

// Mock coworker user context binding
vi.mock("@/helpers/coworker-user-context-binding", () => ({
  requireAuthorizedUserContext: vi.fn(),
}));

// Mock workspace middleware
vi.mock("@/middleware/workspace", () => ({
  requireWorkspaceContext: vi.fn(),
}));

import { requireTaskReadForRouteVars } from "@/helpers/access-control";
import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireWorkspaceContext } from "@/middleware/workspace";

const mockPrisma = mockPrismaClient;
const requireTaskReadForRouteVarsMock = vi.mocked(requireTaskReadForRouteVars);
const requireAuthorizedUserContextMock = vi.mocked(
  requireAuthorizedUserContext,
);
const requireWorkspaceContextMock = vi.mocked(requireWorkspaceContext);

describe("GET /v1/drive/tasks (list)", () => {
  let app: OpenAPIHonoWithAuth;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new OpenAPIHonoWithAuth();
    mountGet(app);
  });

  it("lists projects + no-project row at root level (scope=me)", async () => {
    requireAuthorizedUserContextMock.mockResolvedValue({
      userId: "user_123",
    });
    requireWorkspaceContextMock.mockReturnValue({
      workspaceId: "ws_personal",
      userId: "user_123",
      organizationId: null,
    });

    mockPrisma.project.findMany = vi.fn().mockResolvedValue([
      {
        id: "prj_1",
        name: "Project Alpha",
        tasks: [
          {
            files: [{ updatedAt: new Date("2026-08-18T10:00:00.000Z") }],
          },
        ],
      },
    ]);
    mockPrisma.project.count = vi.fn().mockResolvedValue(1);
    mockPrisma.task.count = vi.fn().mockResolvedValue(3); // no-project tasks
    mockPrisma.taskFile.findFirst = vi.fn().mockResolvedValue({
      updatedAt: new Date("2026-08-17T10:00:00.000Z"),
    });

    const res = await app.request("/", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(2);
    expect(json.data[0]).toMatchObject({
      type: "project",
      id: "prj_1",
      name: "Project Alpha",
    });
    expect(json.data[1]).toMatchObject({
      type: "no-project",
      id: "null",
    });
  });

  it("lists tasks within a project (projectId set)", async () => {
    requireAuthorizedUserContextMock.mockResolvedValue({
      userId: "user_123",
    });
    requireWorkspaceContextMock.mockReturnValue({
      workspaceId: "ws_personal",
      userId: "user_123",
      organizationId: null,
    });

    mockPrisma.task.findMany = vi.fn().mockResolvedValue([
      {
        id: "tsk_1",
        name: "Task One",
        files: [{ updatedAt: new Date("2026-08-18T10:00:00.000Z") }],
      },
      {
        id: "tsk_2",
        name: "Task Two",
        files: [{ updatedAt: new Date("2026-08-17T09:00:00.000Z") }],
      },
    ]);
    mockPrisma.task.count = vi.fn().mockResolvedValue(2);

    const res = await app.request("/?projectId=prj_1&scope=me", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(2);
    expect(json.data[0]).toMatchObject({
      type: "task",
      id: "tsk_1",
      name: "Task One",
    });
    expect(json.data[1]).toMatchObject({
      type: "task",
      id: "tsk_2",
      name: "Task Two",
    });
  });

  it("lists task files within a task (taskId set)", async () => {
    requireAuthorizedUserContextMock.mockResolvedValue({
      userId: "user_123",
    });
    requireTaskReadForRouteVarsMock.mockResolvedValue(undefined);

    mockPrisma.taskFile.findMany = vi.fn().mockResolvedValue([
      {
        id: "tf_1",
        name: "design.pdf",
        fileUrl: "https://example.com/design.pdf",
        size: BigInt(1024),
        mimeType: "application/pdf",
        updatedAt: new Date("2026-08-18T10:00:00.000Z"),
      },
      {
        id: "tf_2",
        name: "notes.txt",
        fileUrl: "https://example.com/notes.txt",
        size: null,
        mimeType: null,
        updatedAt: new Date("2026-08-17T09:00:00.000Z"),
      },
    ]);
    mockPrisma.taskFile.count = vi.fn().mockResolvedValue(2);

    const res = await app.request("/?taskId=tsk_1&scope=me", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(2);
    expect(json.data[0]).toMatchObject({
      type: "task-file",
      id: "tf_1",
      name: "design.pdf",
      fileUrl: "https://example.com/design.pdf",
      size: 1024,
      mimeType: "application/pdf",
    });
    expect(json.data[1]).toMatchObject({
      type: "task-file",
      id: "tf_2",
      name: "notes.txt",
      size: null,
      mimeType: null,
    });
    expect(requireTaskReadForRouteVarsMock).toHaveBeenCalledWith(
      expect.anything(),
      "tsk_1",
    );
  });

  it("filters tasks by assigneeId", async () => {
    requireAuthorizedUserContextMock.mockResolvedValue({
      userId: "user_123",
    });
    requireWorkspaceContextMock.mockReturnValue({
      workspaceId: "ws_personal",
      userId: "user_123",
      organizationId: null,
    });

    mockPrisma.task.findMany = vi.fn().mockResolvedValue([
      {
        id: "tsk_1",
        name: "Assigned Task",
        assigneeId: "cow_123",
        files: [{ updatedAt: new Date("2026-08-18T10:00:00.000Z") }],
      },
    ]);
    mockPrisma.task.count = vi.fn().mockResolvedValue(1);

    const res = await app.request(
      "/?projectId=prj_1&assigneeId=cow_123&scope=me",
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      },
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0].id).toBe("tsk_1");
    expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          assigneeId: "cow_123",
        }),
      }),
    );
  });

  it("requires organizationId when scope=org", async () => {
    requireAuthorizedUserContextMock.mockResolvedValue({
      userId: "user_123",
    });

    const res = await app.request("/?scope=org", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.message).toContain("organizationId");
  });

  it("checks member access for org scope", async () => {
    requireAuthorizedUserContextMock.mockResolvedValue({
      userId: "user_123",
    });

    mockPrisma.workspace.findUnique = vi.fn().mockResolvedValue({
      id: "ws_org",
      organizationId: "org_123",
    });
    mockPrisma.member.findUnique = vi.fn().mockResolvedValue({
      userId: "user_123",
      organizationId: "org_123",
    });

    mockPrisma.project.findMany = vi.fn().mockResolvedValue([]);
    mockPrisma.project.count = vi.fn().mockResolvedValue(0);
    mockPrisma.task.count = vi.fn().mockResolvedValue(0);

    const res = await app.request("/?scope=org&organizationId=org_123", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    expect(res.status).toBe(200);
    expect(mockPrisma.member.findUnique).toHaveBeenCalledWith({
      where: {
        userId_organizationId: {
          userId: "user_123",
          organizationId: "org_123",
        },
      },
    });
  });

  it("skips archived tasks", async () => {
    requireAuthorizedUserContextMock.mockResolvedValue({
      userId: "user_123",
    });
    requireWorkspaceContextMock.mockReturnValue({
      workspaceId: "ws_personal",
      userId: "user_123",
      organizationId: null,
    });

    mockPrisma.task.findMany = vi.fn().mockResolvedValue([]);
    mockPrisma.task.count = vi.fn().mockResolvedValue(0);

    const res = await app.request("/?projectId=prj_1&scope=me", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    expect(res.status).toBe(200);
    expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          archivedAt: null,
        }),
      }),
    );
  });
});
