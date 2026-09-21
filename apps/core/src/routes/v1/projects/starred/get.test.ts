import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import mountGetStarredProjects from "./get.js";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { projectStarFindManyMock } = vi.hoisted(() => ({
  projectStarFindManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { projectStar: { findMany: projectStarFindManyMock } },
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

function createProject(id: string, name: string) {
  return {
    id,
    workspaceId: WORKSPACE_CONTEXT.workspaceId,
    name,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    filesToken: null,
    briefing: null,
    briefingUrl: null,
    contextMd: null,
    contextMdUrl: null,
    contextMdUpdatedAt: null,
    contextMdModel: null,
    contextMdUpdatingSince: null,
    contextMdVersion: 0,
    latestUpdateMd: null,
    latestUpdateMdUpdatedAt: null,
    websiteUrl: null,
    logo: null,
    designMdUrl: null,
    designMdExtractionId: null,
    projectRevision: 0,
    calendarRevision: 0,
    closingAt: null,
    closedAt: null,
  };
}

function createApp(authContext: AuthenticationContext = USER_AUTH_CONTEXT) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", WORKSPACE_CONTEXT);

    return await next();
  });

  mountGetStarredProjects(app);
  return app;
}

describe("GET /projects/starred", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectStarFindManyMock.mockResolvedValue([]);
  });

  it("returns the reader's Pinned projects, oldest Pin first", async () => {
    const olderPin = new Date("2026-09-01T10:00:00.000Z");
    const newerPin = new Date("2026-09-19T10:00:00.000Z");
    projectStarFindManyMock.mockResolvedValue([
      {
        project: createProject("11111111-1111-4111-8111-111111111111", "Old"),
        starredAt: olderPin,
      },
      {
        project: createProject("22222222-2222-4222-8222-222222222222", "New"),
        starredAt: newerPin,
      },
    ]);

    const res = await createApp().request("http://localhost/starred");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.map((p: { name: string }) => p.name)).toEqual([
      "Old",
      "New",
    ]);
    expect(projectStarFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { starredAt: "asc" } }),
    );
  });

  it("carries starredAt, so Pin order survives a client that builds a map", async () => {
    const starredAt = new Date("2026-09-01T10:00:00.000Z");
    projectStarFindManyMock.mockResolvedValue([
      {
        project: createProject("11111111-1111-4111-8111-111111111111", "Old"),
        starredAt,
      },
    ]);

    const res = await createApp().request("http://localhost/starred");

    expect(res.status).toBe(200);
    expect((await res.json()).data[0]?.starredAt).toBe(starredAt.toISOString());
  });

  it("leaves out closed projects and other workspaces", async () => {
    await createApp().request("http://localhost/starred");

    expect(projectStarFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "user_123",
          project: {
            workspaceId: WORKSPACE_CONTEXT.workspaceId,
            closedAt: null,
          },
        },
      }),
    );
  });

  it("bounds the payload without limiting how much a reader may Pin", async () => {
    await createApp().request("http://localhost/starred");

    const [args] = projectStarFindManyMock.mock.calls[0] as [{ take: number }];
    expect(args.take).toBeGreaterThanOrEqual(50);
  });

  it("is empty rather than an error when nothing is Pinned", async () => {
    const res = await createApp().request("http://localhost/starred");

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([]);
  });

  it("refuses a coworker, because a Pin belongs to a person", async () => {
    const res = await createApp(COWORKER_AUTH_CONTEXT).request(
      "http://localhost/starred",
    );

    expect(res.status).toBe(403);
    expect(projectStarFindManyMock).not.toHaveBeenCalled();
  });
});
