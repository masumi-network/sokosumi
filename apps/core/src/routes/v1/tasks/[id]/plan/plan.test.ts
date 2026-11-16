import { TaskLinkType, TaskStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "@/helpers/error-handler";
import { buildHumanTaskVisibilityWhere } from "@/helpers/task-visibility";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountGetTaskPlan from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { requireTaskReadMock, taskFindUniqueMock, taskLinkFindManyMock } =
  vi.hoisted(() => ({
    requireTaskReadMock: vi.fn(),
    taskFindUniqueMock: vi.fn(),
    taskLinkFindManyMock: vi.fn(),
  }));

vi.mock("@/helpers/access-control", () => ({
  requireTaskReadForRouteVars: requireTaskReadMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    task: { findUnique: taskFindUniqueMock },
    taskLink: { findMany: taskLinkFindManyMock },
  },
}));

const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    c.set("requestId", "req_task_plan_test");
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user_123",
      organizationId: "org_123",
      role: "user",
    });
    c.set("workspaceContext", {
      workspaceId: WORKSPACE_ID,
      userId: null,
      organizationId: "org_123",
    });
    return await next();
  });
  mountGetTaskPlan(app);
  return app;
}

function task(id: string, number: number | null = null) {
  return {
    id,
    name: `Task ${id}`,
    status: TaskStatus.READY,
    archivedAt: null,
    number,
    project: number ? { identifier: "LAU" } : null,
  };
}

function subTaskLink(parentId: string, childId: string, number?: number) {
  return {
    id: `pl_${parentId}_${childId}`,
    fromTaskId: parentId,
    toTaskId: childId,
    type: TaskLinkType.PARENT,
    fromTask: task(parentId),
    toTask: task(childId, number),
  };
}

function blockerLink(blockerId: string, blockedId: string) {
  return {
    id: `bl_${blockerId}_${blockedId}`,
    fromTaskId: blockerId,
    toTaskId: blockedId,
    type: TaskLinkType.BLOCKS,
    fromTask: task(blockerId),
    toTask: task(blockedId),
  };
}

describe("GET /tasks/{id}/plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireTaskReadMock.mockResolvedValue(undefined);
    taskFindUniqueMock.mockResolvedValue({ id: "root" });
    taskLinkFindManyMock.mockResolvedValue([]);
  });

  it("walks sub-tasks and blockers level by level into plan rows", async () => {
    taskLinkFindManyMock
      .mockResolvedValueOnce([
        subTaskLink("root", "a", 7),
        blockerLink("b", "root"),
      ])
      .mockResolvedValueOnce([subTaskLink("a", "a1")])
      .mockResolvedValue([]);

    const response = await createApp().request("http://localhost/root/plan");

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        truncated: boolean;
        items: {
          depth: number;
          relation: string;
          repeat: string | null;
          hasMore: boolean;
          task: { id: string; identifier: string | null };
        }[];
      };
    };
    expect(
      body.data.items.map((item) => [item.depth, item.relation, item.task.id]),
    ).toEqual([
      [1, "blocked_by", "b"],
      [1, "parent", "a"],
      [2, "parent", "a1"],
    ]);
    expect(body.data.items[1]?.task.identifier).toBe("LAU-7");
    expect(body.data.truncated).toBe(false);
    expect(
      taskLinkFindManyMock.mock.calls[1]?.[0].where.OR[0].fromTaskId,
    ).toEqual({ in: ["a", "b"] });
  });

  it("only follows links to open Tasks the reader can see", async () => {
    await createApp().request("http://localhost/root/plan");

    const visible = {
      AND: [
        {
          workspaceId: WORKSPACE_ID,
          archivedAt: null,
          ...buildHumanTaskVisibilityWhere("user_123"),
        },
        { archivedAt: null },
      ],
    };
    expect(taskLinkFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            {
              type: TaskLinkType.PARENT,
              fromTaskId: { in: ["root"] },
              toTask: { is: visible },
            },
            {
              type: TaskLinkType.BLOCKS,
              toTaskId: { in: ["root"] },
              fromTask: { is: visible },
            },
          ],
        },
      }),
    );
  });

  it("marks the plan truncated when a level has more links than it reads", async () => {
    taskLinkFindManyMock.mockResolvedValueOnce(
      Array.from({ length: 201 }, (_, index) =>
        subTaskLink("root", `c${index}`),
      ),
    );

    const response = await createApp().request("http://localhost/root/plan");
    const body = (await response.json()) as { data: { truncated: boolean } };

    expect(body.data.truncated).toBe(true);
  });

  it("checks read access and 404s an archived or missing Task", async () => {
    taskFindUniqueMock.mockResolvedValue(null);

    const response = await createApp().request("http://localhost/root/plan");

    expect(response.status).toBe(404);
    expect(requireTaskReadMock).toHaveBeenCalledWith(
      expect.anything(),
      "root",
      expect.anything(),
    );
    expect(taskLinkFindManyMock).not.toHaveBeenCalled();
  });
});
