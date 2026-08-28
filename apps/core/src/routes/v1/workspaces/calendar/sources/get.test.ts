import { HTTPException } from "hono/http-exception";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

const {
  projectFindManyMock,
  taskScheduleOccurrenceFindFirstMock,
  workspaceFindUniqueMock,
} = vi.hoisted(() => ({
  projectFindManyMock: vi.fn(),
  taskScheduleOccurrenceFindFirstMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    project: { findMany: projectFindManyMock },
    taskScheduleOccurrence: { findFirst: taskScheduleOccurrenceFindFirstMock },
    workspace: { findUnique: workspaceFindUniqueMock },
  },
}));

vi.mock("@/middleware/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/middleware/auth")>()),
  authMiddleware: (await import("@/test-fixtures/auth-middleware"))
    .stubAuthMiddleware,
}));

vi.mock("@/helpers/coworker-user-context-binding", () => ({
  requireAuthorizedUserContext: async (authContext: AuthenticationContext) => {
    if (authContext.actor === "user") {
      return { source: "session" as const, ...authContext };
    }
    throw new HTTPException(403, { message: "User authentication required" });
  },
}));

const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";
const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

let mountGetWorkspaceCalendarSources: (app: OpenAPIHonoWithAuth) => void;

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("requestId", "req_calendar_sources");
    c.set("isAuthenticated", true);
    c.set("authContext", USER_AUTH_CONTEXT);
    c.set("workspaceContext", {
      workspaceId: WORKSPACE_ID,
      userId: "user_123",
      organizationId: null,
    });
    return await next();
  });
  mountGetWorkspaceCalendarSources(app);
  return app;
}

describe("GET /workspaces/calendar/sources", () => {
  beforeAll(async () => {
    const module = await import("./get");
    mountGetWorkspaceCalendarSources = module.default;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    workspaceFindUniqueMock.mockResolvedValue({
      organization: null,
      user: { name: "Ada Lovelace", image: "https://example.com/ada.png" },
    });
    projectFindManyMock.mockResolvedValue([]);
    taskScheduleOccurrenceFindFirstMock.mockResolvedValue(null);
  });

  it("lists the workspace first, followed by active and closed projects in stable order", async () => {
    projectFindManyMock.mockResolvedValue([
      {
        id: "22222222-2222-7222-8222-222222222222",
        name: "Alpha",
        logo: "https://example.com/alpha.png",
        closedAt: null,
      },
      {
        id: "33333333-3333-7333-8333-333333333333",
        name: "Zeta",
        logo: null,
        closedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);

    const response = await createApp().request(
      "http://localhost/calendar/sources",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: [
        {
          sourceId: `workspace:${WORKSPACE_ID}`,
          sourceType: "WORKSPACE",
          displayName: "Ada Lovelace",
          logoUrl: "https://example.com/ada.png",
          paletteToken: "blue",
        },
        {
          sourceId: "project:22222222-2222-7222-8222-222222222222",
          sourceType: "PROJECT",
          displayName: "Alpha",
          logoUrl: "https://example.com/alpha.png",
          paletteToken: "violet",
        },
        {
          sourceId: "project:33333333-3333-7333-8333-333333333333",
          sourceType: "PROJECT",
          displayName: "Zeta",
          logoUrl: null,
          paletteToken: "violet",
        },
      ],
      meta: expect.objectContaining({ requestId: "req_calendar_sources" }),
    });
    expect(projectFindManyMock).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, name: true, logo: true, closedAt: true },
    });
  });

  it("adds the legacy source only when the workspace has legacy occurrences", async () => {
    taskScheduleOccurrenceFindFirstMock.mockResolvedValue({
      id: "occurrence_1",
    });

    const response = await createApp().request(
      "http://localhost/calendar/sources",
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.at(-1)).toEqual({
      sourceId: `legacy-unknown:${WORKSPACE_ID}`,
      sourceType: "LEGACY_UNKNOWN",
      displayName: "Legacy source",
      logoUrl: null,
      paletteToken: "amber",
    });
    expect(taskScheduleOccurrenceFindFirstMock).toHaveBeenCalledWith({
      where: {
        sourceWorkspaceId: WORKSPACE_ID,
        sourceType: "LEGACY_UNKNOWN",
      },
      select: { id: true },
    });
  });
});
