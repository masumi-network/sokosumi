import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import mountDeleteProjectHide from "./delete.js";
import mountGetProjectHide from "./get.js";
import mountPostProjectHide from "./post.js";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  projectFindFirstMock,
  projectHideUpsertMock,
  projectHideDeleteManyMock,
  projectStarDeleteManyMock,
  transactionMock,
} = vi.hoisted(() => ({
  projectFindFirstMock: vi.fn(),
  projectHideUpsertMock: vi.fn(),
  projectHideDeleteManyMock: vi.fn(),
  projectStarDeleteManyMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: transactionMock,
    project: { findFirst: projectFindFirstMock },
    projectHide: {
      upsert: projectHideUpsertMock,
      deleteMany: projectHideDeleteManyMock,
    },
    projectStar: { deleteMany: projectStarDeleteManyMock },
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
const HIDDEN_AT = new Date("2026-10-29T10:00:00.000Z");
const KEY = { userId: "user_123", projectId: PROJECT_ID };

function createApp(authContext: AuthenticationContext = USER_AUTH_CONTEXT) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", WORKSPACE_CONTEXT);

    return await next();
  });

  mountGetProjectHide(app);
  mountPostProjectHide(app);
  mountDeleteProjectHide(app);
  return app;
}

function hide(
  method: "GET" | "POST" | "DELETE",
  authContext?: AuthenticationContext,
) {
  return createApp(authContext).request(`http://localhost/${PROJECT_ID}/hide`, {
    method,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  projectFindFirstMock.mockResolvedValue({ id: PROJECT_ID, hides: [] });
  projectHideUpsertMock.mockResolvedValue({ hiddenAt: HIDDEN_AT });
  projectHideDeleteManyMock.mockResolvedValue({ count: 1 });
  projectStarDeleteManyMock.mockResolvedValue({ count: 0 });
  transactionMock.mockImplementation(
    async (operations: Array<Promise<unknown>>) =>
      await Promise.all(operations),
  );
});

describe("POST /projects/{id}/hide", () => {
  it("Hides the project for the acting user, keeping the first hiddenAt", async () => {
    const res = await hide("POST");

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      projectId: PROJECT_ID,
      hiddenAt: HIDDEN_AT.toISOString(),
      unpinned: false,
    });
    expect(projectHideUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_projectId: KEY },
        create: KEY,
        update: {},
      }),
    );
  });

  it("unpins a Pinned project in the same transaction and says so", async () => {
    projectStarDeleteManyMock.mockResolvedValue({ count: 1 });

    const res = await hide("POST");

    expect((await res.json()).data.unpinned).toBe(true);
    expect(projectStarDeleteManyMock).toHaveBeenCalledWith({ where: KEY });
    expect(transactionMock).toHaveBeenCalledOnce();
  });

  it("is a 404 for a project outside the active workspace", async () => {
    projectFindFirstMock.mockResolvedValue(null);

    const res = await hide("POST");

    expect(res.status).toBe(404);
    expect(projectFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PROJECT_ID, workspaceId: WORKSPACE_CONTEXT.workspaceId },
      }),
    );
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("refuses a coworker, because a Hide belongs to a person", async () => {
    const res = await hide("POST", COWORKER_AUTH_CONTEXT);

    expect(res.status).toBe(403);
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

describe("DELETE /projects/{id}/hide", () => {
  it("shows the project again without touching its Pin", async () => {
    const res = await hide("DELETE");

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      projectId: PROJECT_ID,
      hiddenAt: null,
    });
    expect(projectHideDeleteManyMock).toHaveBeenCalledWith({ where: KEY });
    expect(projectStarDeleteManyMock).not.toHaveBeenCalled();
  });

  it("succeeds when the project was never Hidden", async () => {
    projectHideDeleteManyMock.mockResolvedValue({ count: 0 });

    expect((await hide("DELETE")).status).toBe(200);
  });

  it("is a 404 for a project outside the active workspace", async () => {
    projectFindFirstMock.mockResolvedValue(null);

    expect((await hide("DELETE")).status).toBe(404);
    expect(projectHideDeleteManyMock).not.toHaveBeenCalled();
  });

  it("refuses a coworker", async () => {
    expect((await hide("DELETE", COWORKER_AUTH_CONTEXT)).status).toBe(403);
    expect(projectHideDeleteManyMock).not.toHaveBeenCalled();
  });
});

describe("GET /projects/{id}/hide", () => {
  it("reports the reader's own Hide", async () => {
    projectFindFirstMock.mockResolvedValue({
      id: PROJECT_ID,
      hides: [{ hiddenAt: HIDDEN_AT }],
    });

    const res = await hide("GET");

    expect((await res.json()).data).toEqual({
      projectId: PROJECT_ID,
      hiddenAt: HIDDEN_AT.toISOString(),
    });
    expect(projectFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          hides: {
            where: { userId: "user_123" },
            select: { hiddenAt: true },
          },
        }),
      }),
    );
  });

  it("reports null for a project the reader has not Hidden", async () => {
    expect((await (await hide("GET")).json()).data.hiddenAt).toBeNull();
  });

  it("is a 404 for a project outside the active workspace", async () => {
    projectFindFirstMock.mockResolvedValue(null);

    expect((await hide("GET")).status).toBe(404);
  });
});
