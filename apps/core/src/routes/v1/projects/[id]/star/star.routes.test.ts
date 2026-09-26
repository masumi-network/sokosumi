import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import mountDeleteProjectStar from "./delete.js";
import mountPostProjectStar from "./post.js";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  projectFindFirstMock,
  projectStarUpsertMock,
  projectStarDeleteManyMock,
} = vi.hoisted(() => ({
  projectFindFirstMock: vi.fn(),
  projectStarUpsertMock: vi.fn(),
  projectStarDeleteManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    project: { findFirst: projectFindFirstMock },
    projectStar: {
      upsert: projectStarUpsertMock,
      deleteMany: projectStarDeleteManyMock,
    },
  },
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const COWORKER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "coworker_123",
  vendorId: TEST_VENDOR_ID,
};

const WORKSPACE_CONTEXT = {
  workspaceId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  userId: "user_123",
  organizationId: null,
} satisfies WorkspaceVariables["workspaceContext"];

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const STARRED_AT = new Date("2026-09-20T10:00:00.000Z");

function createApp(authContext: AuthenticationContext = USER_AUTH_CONTEXT) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", WORKSPACE_CONTEXT);

    return await next();
  });

  mountPostProjectStar(app);
  mountDeleteProjectStar(app);
  return app;
}

function star(method: "POST" | "DELETE", projectId = PROJECT_ID) {
  return createApp().request(`http://localhost/${projectId}/star`, { method });
}

beforeEach(() => {
  vi.clearAllMocks();
  projectFindFirstMock.mockResolvedValue({ id: PROJECT_ID });
  projectStarUpsertMock.mockResolvedValue({ starredAt: STARRED_AT });
  projectStarDeleteManyMock.mockResolvedValue({ count: 1 });
});

describe("POST /projects/{id}/star", () => {
  it("Pins the project for the acting user", async () => {
    const res = await star("POST");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({
      projectId: PROJECT_ID,
      starredAt: STARRED_AT.toISOString(),
    });
  });

  it("keeps the original starredAt when the project is already Pinned", async () => {
    await star("POST");

    // An empty `update` is what stops a second star from rewriting the
    // stamp, which would move the project to the end of the reader's Pins.
    expect(projectStarUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_projectId: { userId: "user_123", projectId: PROJECT_ID },
        },
        create: { userId: "user_123", projectId: PROJECT_ID },
        update: {},
      }),
    );
  });

  it("scopes the lookup to the active workspace", async () => {
    await star("POST");

    expect(projectFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: PROJECT_ID,
          workspaceId: WORKSPACE_CONTEXT.workspaceId,
        },
      }),
    );
  });

  it("is a 404 for a project outside the active workspace", async () => {
    projectFindFirstMock.mockResolvedValue(null);

    const res = await star("POST");

    expect(res.status).toBe(404);
    expect(projectStarUpsertMock).not.toHaveBeenCalled();
  });

  it("refuses a coworker, because a Pin belongs to a person", async () => {
    const res = await createApp(COWORKER_AUTH_CONTEXT).request(
      `http://localhost/${PROJECT_ID}/star`,
      { method: "POST" },
    );

    expect(res.status).toBe(403);
    expect(projectStarUpsertMock).not.toHaveBeenCalled();
  });
});

describe("DELETE /projects/{id}/star", () => {
  it("clears the Pin and reports it gone", async () => {
    const res = await star("DELETE");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({ projectId: PROJECT_ID, starredAt: null });
    expect(projectStarDeleteManyMock).toHaveBeenCalledWith({
      where: { userId: "user_123", projectId: PROJECT_ID },
    });
  });

  it("succeeds when the project was never Pinned", async () => {
    projectStarDeleteManyMock.mockResolvedValue({ count: 0 });

    const res = await star("DELETE");

    expect(res.status).toBe(200);
    expect((await res.json()).data.starredAt).toBeNull();
  });

  it("is a 404 for a project outside the active workspace", async () => {
    projectFindFirstMock.mockResolvedValue(null);

    const res = await star("DELETE");

    expect(res.status).toBe(404);
    expect(projectStarDeleteManyMock).not.toHaveBeenCalled();
  });

  it("refuses a coworker", async () => {
    const res = await createApp(COWORKER_AUTH_CONTEXT).request(
      `http://localhost/${PROJECT_ID}/star`,
      { method: "DELETE" },
    );

    expect(res.status).toBe(403);
    expect(projectStarDeleteManyMock).not.toHaveBeenCalled();
  });
});
