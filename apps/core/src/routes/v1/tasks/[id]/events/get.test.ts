import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";

import mountGetTaskEvents from "./get";

const { requireTaskReadForRouteVarsMock, taskEventFindManyMock } = vi.hoisted(
  () => ({
    requireTaskReadForRouteVarsMock: vi.fn(),
    taskEventFindManyMock: vi.fn(),
  }),
);

vi.mock("@/helpers/access-control", () => ({
  requireTaskReadForRouteVars: requireTaskReadForRouteVarsMock,
}));

vi.mock("@/lib/db/prisma", () => {
  const tx = {
    taskEvent: {
      findMany: taskEventFindManyMock,
    },
  };
  return {
    default: {
      $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
    },
  };
});

const TASK_ID = "tsk_123";

const OWNER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_owner",
  organizationId: null,
  role: "user",
};

const NON_OWNER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_other",
  organizationId: null,
  role: "user",
};

const DELEGATED_COWORKER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_123",
  delegation: {
    userId: "user_owner",
    organizationId: null,
  },
};

function createApp(authContext: AuthenticationContext) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  mountGetTaskEvents(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

describe("GET /tasks/:id/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireTaskReadForRouteVarsMock.mockResolvedValue({
      id: TASK_ID,
      userId: "user_owner",
    });
    taskEventFindManyMock.mockResolvedValue([]);
  });

  it("includes held comments for the task owner", async () => {
    const app = createApp(OWNER_AUTH_CONTEXT);
    const response = await app.request(`/${TASK_ID}/events`);

    expect(response.status).toBe(200);
    expect(taskEventFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taskId: TASK_ID },
      }),
    );
  });

  it("hides held comments from session users who do not own the task", async () => {
    const app = createApp(NON_OWNER_AUTH_CONTEXT);
    const response = await app.request(`/${TASK_ID}/events`);

    expect(response.status).toBe(200);
    expect(taskEventFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taskId: TASK_ID, heldByGrantId: null },
      }),
    );
  });

  it("hides held comments from delegated coworker contexts", async () => {
    const app = createApp(DELEGATED_COWORKER_AUTH_CONTEXT);
    const response = await app.request(`/${TASK_ID}/events`);

    expect(response.status).toBe(200);
    expect(taskEventFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taskId: TASK_ID, heldByGrantId: null },
      }),
    );
  });
});
