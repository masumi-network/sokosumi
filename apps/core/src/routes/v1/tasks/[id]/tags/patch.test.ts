import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import mount from "./patch";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});
const { transactionMock, findFirstMock, updateMock, queryRawMock } = vi.hoisted(
  () => ({
    transactionMock: vi.fn(),
    findFirstMock: vi.fn(),
    updateMock: vi.fn(),
    queryRawMock: vi.fn(),
  }),
);
vi.mock("@/lib/db/prisma", () => ({
  default: { $transaction: transactionMock },
}));
const user: AuthenticationContext = {
  actor: "user",
  userId: "owner-1",
  organizationId: null,
  role: "user",
};
const task = {
  id: "task-1",
  ownerId: "owner-1",
  workspaceId: "workspace-1",
  status: "DRAFT",
  automaticTags: ["research", "writing"],
  manualTags: ["design"],
  rejectedTags: ["seo"],
};
function createApp(authContext = user, workspaceId = "workspace-1") {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("requestId", "task-tags-test");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", {
      workspaceId,
      userId: "owner-1",
      organizationId: null,
    });
    await next();
  });
  app.onError(errorHandler);
  mount(app);
  return app;
}
function patch(body: unknown, app = createApp()) {
  return app.request("http://localhost/task-1/tags", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  findFirstMock.mockResolvedValue(task);
  queryRawMock.mockResolvedValue([{ id: task.id }]);
  transactionMock.mockImplementation(async (callback) =>
    callback({
      $queryRaw: queryRawMock,
      task: { findFirst: findFirstMock, update: updateMock },
    }),
  );
  updateMock.mockImplementation(async ({ data }) => ({ ...task, ...data }));
});

describe("PATCH /tasks/{id}/tags", () => {
  it("persists corrections, restores rejected tags, and returns effective automatic tags", async () => {
    const response = await patch({ add: ["seo"], remove: ["research"] });
    expect(response.status).toBe(200);
    expect(findFirstMock).toHaveBeenCalledWith({
      where: { id: "task-1", ownerId: "owner-1", archivedAt: null },
    });
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: { manualTags: ["design", "seo"], rejectedTags: ["research"] },
    });
    expect(await response.json()).toMatchObject({
      data: {
        automatic: ["writing"],
        manual: ["design", "seo"],
        rejected: ["research"],
      },
    });
    expect(queryRawMock).toHaveBeenCalledTimes(1);
  });
  it("deduplicates repeated corrections", async () => {
    const response = await patch({
      add: ["design", "design"],
      remove: ["seo", "seo"],
    });
    expect(response.status).toBe(200);
    expect(updateMock.mock.calls[0]![0].data).toEqual({
      manualTags: ["design"],
      rejectedTags: ["seo"],
    });
  });
  it.each([
    { add: ["unknown"] },
    { remove: ["unknown"] },
    { add: ["research"], remove: ["research"] },
    { add: ["research", "strategy", "writing", "design", "analysis", "seo"] },
  ])(
    "rejects invalid vocabulary or contradictory corrections %j before writes",
    async (body) => {
      const response = await patch(body);
      expect(response.status).toBe(422);
      expect(transactionMock).not.toHaveBeenCalled();
      expect(updateMock).not.toHaveBeenCalled();
    },
  );
  it("rejects corrections exceeding the existing five manual tag limit", async () => {
    findFirstMock.mockResolvedValue({
      ...task,
      manualTags: ["research", "strategy", "writing", "design", "analysis"],
    });
    const response = await patch({ add: ["seo"] });
    expect(response.status).toBe(422);
    expect(updateMock).not.toHaveBeenCalled();
  });
  it("does not reveal or mutate a task not owned by the actor", async () => {
    findFirstMock.mockResolvedValue(null);
    const response = await patch({ add: ["seo"] });
    expect(response.status).toBe(404);
    expect(findFirstMock).toHaveBeenCalledWith({
      where: { id: "task-1", ownerId: "owner-1", archivedAt: null },
    });
    expect(updateMock).not.toHaveBeenCalled();
  });
  it("rejects a task outside the active workspace", async () => {
    const response = await patch(
      { add: ["seo"] },
      createApp(user, "other-workspace"),
    );
    expect(response.status).toBe(404);
    expect(updateMock).not.toHaveBeenCalled();
  });
  it("rejects coworker impersonation of the owner before database access", async () => {
    const response = await patch(
      { add: ["seo"] },
      createApp({
        actor: "coworker",
        coworkerId: "coworker-1",
        vendorId: "vendor-1",
        context: { userId: "owner-1", organizationId: null },
      }),
    );
    expect(response.status).toBe(403);
    expect(transactionMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });
});
