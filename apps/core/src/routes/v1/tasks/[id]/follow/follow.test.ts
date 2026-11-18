import { beforeEach, describe, expect, it, vi } from "vitest";

import { conflict } from "@/helpers/error";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

import mountDeleteTaskFollow from "./delete";
import mountPostTaskFollow from "./post";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const m = vi.hoisted(() => ({
  commentAccess: vi.fn(),
  readAccess: vi.fn(),
  followTask: vi.fn(),
  unfollowTask: vi.fn(),
}));

vi.mock("@/helpers/access-control", () => ({
  requireTaskCommentAccess: m.commentAccess,
  requireTaskReadForRouteVars: m.readAccess,
}));
vi.mock("@/services/task-follow.service", () => ({
  followTask: m.followTask,
  unfollowTask: m.unfollowTask,
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => run("tx"),
  },
}));

const TASK = { id: "tsk_1", workspaceId: "ws_1" };
const HUMAN = {
  actor: "user",
  userId: "user_alice",
  organizationId: "org_1",
  role: "user",
} as AuthenticationContext;
const COWORKER = {
  actor: "coworker",
  coworkerId: "cow_1",
  vendorId: "ven_1",
} as unknown as AuthenticationContext;

function request(method: "POST" | "DELETE", auth = HUMAN) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("authContext", auth);
    c.set("isAuthenticated", true);
    return await next();
  });
  mountPostTaskFollow(app);
  mountDeleteTaskFollow(app);
  return app.request("http://localhost/tsk_1/follow", { method });
}

describe("/tasks/{id}/follow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.commentAccess.mockResolvedValue(TASK);
    m.readAccess.mockResolvedValue(TASK);
    m.followTask.mockResolvedValue([]);
    m.unfollowTask.mockResolvedValue([]);
  });

  it("follows for the signed-in person, behind comment access", async () => {
    const response = await request("POST");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { followers: [] } });
    expect(m.commentAccess).toHaveBeenCalled();
    expect(m.followTask).toHaveBeenCalledWith("tx", TASK, "user_alice");
  });

  it("says when there is no Soko Bot to follow with", async () => {
    m.followTask.mockRejectedValue(
      conflict("Set up your Soko Bot to follow this Task"),
    );
    expect((await request("POST")).status).toBe(409);
  });

  it("lets a reader stop following without comment access", async () => {
    expect((await request("DELETE")).status).toBe(200);
    expect(m.commentAccess).not.toHaveBeenCalled();
    expect(m.unfollowTask).toHaveBeenCalledWith("tx", TASK, "user_alice");
  });

  it.each(["POST", "DELETE"] as const)(
    "refuses a coworker on %s",
    async (method) => {
      expect((await request(method, COWORKER)).status).toBe(403);
      expect(m.followTask).not.toHaveBeenCalled();
      expect(m.unfollowTask).not.toHaveBeenCalled();
    },
  );
});
