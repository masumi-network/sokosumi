import { beforeEach, describe, expect, it, vi } from "vitest";
import { LIMITS } from "@/config/constants";
import { encodeProjectActivityCursor } from "@/helpers/project-activity";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";
import {
  createProjectListCountsInclude,
  humanProjectReaderVisibility,
} from "@/types/project";

import mountListProjects from "./get.js";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { projectCountMock, projectFindManyMock, queryRawMock } = vi.hoisted(
  () => ({
    projectCountMock: vi.fn(),
    projectFindManyMock: vi.fn(),
    queryRawMock: vi.fn(),
  }),
);

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $queryRaw: queryRawMock,
    project: {
      findMany: projectFindManyMock,
      count: projectCountMock,
    },
  },
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const WORKSPACE_CONTEXT = {
  workspaceId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  userId: "user_123",
  organizationId: null,
} satisfies WorkspaceVariables["workspaceContext"];

function createApp(
  authContext: AuthenticationContext = USER_AUTH_CONTEXT,
  workspaceContext:
    | WorkspaceVariables["workspaceContext"]
    | null = WORKSPACE_CONTEXT,
) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", workspaceContext);

    return await next();
  });

  mountListProjects(app);
  return app;
}

const PROJECT_ROW = {
  id: "11111111-1111-4111-8111-111111111111",
  workspaceId: WORKSPACE_CONTEXT.workspaceId,
  name: "Research",
  websiteUrl: null,
  logo: null,
  designMdUrl: null,
  designMdExtractionId: null,
  briefing: null as string | null,
  briefingUrl: null as string | null,
  contextMd: null,
  contextMdUrl: null,
  contextMdUpdatedAt: null,
  contextMdModel: null,
  contextMdUpdatingSince: null,
  contextMdVersion: 0,
  latestUpdateMd: null,
  latestUpdateMdUpdatedAt: null,
  createdAt: new Date("2026-04-01T10:00:00.000Z"),
  updatedAt: new Date("2026-04-01T10:00:00.000Z"),
  _count: { tasks: 0, jobs: 0 },
};

function createProjectRow(overrides: Partial<typeof PROJECT_ROW> = {}) {
  return { ...PROJECT_ROW, ...overrides };
}

describe("GET /projects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectFindManyMock.mockResolvedValue([]);
    projectCountMock.mockResolvedValue(0);
    queryRawMock.mockResolvedValue([]);
  });

  it("returns projects for the active workspace with pagination metadata", async () => {
    const sample = createProjectRow({
      briefing: "Notes",
      briefingUrl: "https://blob.example/projects/project_1/BRIEFING.md",
      _count: { tasks: 2, jobs: 1 },
    });
    projectFindManyMock.mockResolvedValue([sample]);
    queryRawMock.mockResolvedValue([
      { id: sample.id, lastActivityAt: sample.updatedAt },
    ]);
    projectCountMock.mockResolvedValue(1);

    const app = createApp();
    const res = await app.request("http://localhost/");

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{
        id: string;
        name: string;
        taskCount: number;
        jobCount: number;
      }>;
      meta: {
        pagination: {
          total: number;
          limit: number;
          nextCursor: string | null;
          cursor: string | null;
        };
      };
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.id).toBe("11111111-1111-4111-8111-111111111111");
    expect(body.data[0]?.name).toBe("Research");
    expect(body.data[0]?.taskCount).toBe(2);
    expect(body.data[0]?.jobCount).toBe(1);
    expect(body.meta.pagination.total).toBe(1);
    expect(body.meta.pagination.limit).toBe(LIMITS.DEFAULT_PAGINATION_LIMIT);
    expect(body.meta.pagination.nextCursor).toBeNull();
    expect(body.meta.pagination.cursor).toBeNull();

    expect(projectFindManyMock).toHaveBeenCalledWith({
      where: {
        workspaceId: WORKSPACE_CONTEXT.workspaceId,
        id: { in: [sample.id] },
      },
      include: createProjectListCountsInclude(
        WORKSPACE_CONTEXT.workspaceId,
        humanProjectReaderVisibility(USER_AUTH_CONTEXT.userId),
      ),
    });
    expect(projectCountMock).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_CONTEXT.workspaceId },
    });
  });

  it("filters the ranked query and the total by the q parameter", async () => {
    const project = createProjectRow({ name: "Autumn Launch" });
    projectFindManyMock.mockResolvedValue([project]);
    queryRawMock.mockResolvedValue([
      { id: project.id, lastActivityAt: project.updatedAt },
    ]);
    projectCountMock.mockResolvedValue(1);

    const res = await createApp().request("http://localhost/?q=autumn");

    expect(res.status).toBe(200);
    expect(queryRawMock.mock.calls[0][0].values).toEqual(
      expect.arrayContaining(["%autumn%"]),
    );
    expect(queryRawMock.mock.calls[1][0].values).toEqual(
      expect.arrayContaining(["%autumn%"]),
    );
    expect(projectCountMock).not.toHaveBeenCalled();
  });

  it("escapes ILIKE wildcards so a search stays a literal substring", async () => {
    const res = await createApp().request("http://localhost/?q=50%25_off");

    expect(res.status).toBe(200);
    expect(queryRawMock.mock.calls).toHaveLength(2);
    for (const [sql] of queryRawMock.mock.calls) {
      expect(sql.values).toEqual(expect.arrayContaining(["%50\\%\\_off%"]));
    }
    expect(projectCountMock).not.toHaveBeenCalled();
  });

  it("leaves the query unfiltered when q is absent", async () => {
    const res = await createApp().request("http://localhost/");

    expect(res.status).toBe(200);
    expect(projectCountMock).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_CONTEXT.workspaceId },
    });
  });

  it("returns each project's lastActivityAt from its ranked row", async () => {
    const project = createProjectRow();
    const lastActivityAt = new Date("2026-04-09T08:30:00.000Z");
    projectFindManyMock.mockResolvedValue([project]);
    queryRawMock.mockResolvedValue([{ id: project.id, lastActivityAt }]);
    projectCountMock.mockResolvedValue(1);

    const res = await createApp().request("http://localhost/");

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ lastActivityAt: string }>;
    };
    expect(body.data[0]?.lastActivityAt).toBe(lastActivityAt.toISOString());
  });

  it("returns nextCursor when more than one page of results exists", async () => {
    const rows = Array.from(
      { length: LIMITS.DEFAULT_PAGINATION_LIMIT + 1 },
      (_, i) =>
        createProjectRow({
          id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
          name: `P${i}`,
        }),
    );
    projectFindManyMock.mockResolvedValue([...rows].reverse());
    queryRawMock.mockResolvedValue(
      rows.map(({ id, createdAt }) => ({ id, lastActivityAt: createdAt })),
    );
    projectCountMock.mockResolvedValue(50);

    const app = createApp();
    const res = await app.request("http://localhost/");

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ id: string }>;
      meta: { pagination: { nextCursor: string | null } };
    };
    expect(body.data).toHaveLength(LIMITS.DEFAULT_PAGINATION_LIMIT);
    expect(body.data.map(({ id }) => id)).toEqual(
      rows.slice(0, LIMITS.DEFAULT_PAGINATION_LIMIT).map(({ id }) => id),
    );
    expect(body.meta.pagination.nextCursor).toBe(
      encodeProjectActivityCursor(WORKSPACE_CONTEXT.workspaceId, {
        id: rows[LIMITS.DEFAULT_PAGINATION_LIMIT - 1].id,
        lastActivityAt: rows[0].createdAt,
      }),
    );
  });

  it("passes a bounded cursor query for the next globally ordered page", async () => {
    const cursorId = "11111111-1111-4111-8111-111111111111";
    const cursor = encodeProjectActivityCursor(WORKSPACE_CONTEXT.workspaceId, {
      id: cursorId,
      lastActivityAt: new Date("2026-04-01T10:00:00.000Z"),
    });
    projectFindManyMock.mockResolvedValue([]);
    projectCountMock.mockResolvedValue(0);

    const app = createApp();
    const res = await app.request(
      `http://localhost/?cursor=${encodeURIComponent(cursor)}&limit=10`,
    );

    expect(res.status).toBe(200);
    expect(queryRawMock).toHaveBeenCalledOnce();
    expect(queryRawMock.mock.calls[0][0].values).toEqual(
      expect.arrayContaining([cursorId, 11, WORKSPACE_CONTEXT.workspaceId]),
    );
  });

  it.each([
    "not-a-cursor",
    Buffer.from(
      JSON.stringify({
        workspaceId: WORKSPACE_CONTEXT.workspaceId,
        id: "not-an-id",
        lastActivityAt: "not-a-date",
      }),
    ).toString("base64url"),
    encodeProjectActivityCursor("bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb", {
      id: "11111111-1111-4111-8111-111111111111",
      lastActivityAt: new Date("2026-04-01"),
    }),
  ])(
    "rejects invalid or foreign-workspace cursors before querying",
    async (cursor) => {
      const res = await createApp().request(
        `http://localhost/?cursor=${encodeURIComponent(cursor)}`,
      );
      expect(res.status).toBe(400);
      expect(queryRawMock).not.toHaveBeenCalled();
    },
  );

  it("keeps the ranked boundary when a project disappears before hydration", async () => {
    const ranked = [1, 2].map((n) => ({
      id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
      lastActivityAt: new Date("2026-04-01"),
    }));
    queryRawMock.mockResolvedValue(ranked);
    projectFindManyMock.mockResolvedValue([]);
    const res = await createApp().request("http://localhost/?limit=1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(body.meta.pagination.nextCursor).toBe(
      encodeProjectActivityCursor(WORKSPACE_CONTEXT.workspaceId, ranked[0]),
    );
  });

  it("returns 403 when workspace context is missing", async () => {
    const app = createApp(USER_AUTH_CONTEXT, null);
    const res = await app.request("http://localhost/");
    expect(res.status).toBe(403);
    expect(queryRawMock).not.toHaveBeenCalled();
  });

  it("returns 403 for coworker without delegation", async () => {
    const app = createApp(
      { actor: "coworker", coworkerId: "cow_1", vendorId: TEST_VENDOR_ID },
      null,
    );
    const res = await app.request("http://localhost/");
    expect(res.status).toBe(403);
    expect(queryRawMock).not.toHaveBeenCalled();
  });
});
