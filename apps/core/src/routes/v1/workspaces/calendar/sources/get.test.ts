import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

const {
  coworkerFindFirstMock,
  hasAssignedOrganizationSeatMock,
  projectFindManyMock,
  resolveWorkspaceForContextMock,
  taskFindFirstMock,
  taskScheduleOccurrenceFindFirstMock,
  userFindUniqueMock,
  vendorGrantFindUniqueMock,
  workspaceFindUniqueMock,
} = vi.hoisted(() => ({
  coworkerFindFirstMock: vi.fn(),
  hasAssignedOrganizationSeatMock: vi.fn(),
  projectFindManyMock: vi.fn(),
  resolveWorkspaceForContextMock: vi.fn(),
  taskFindFirstMock: vi.fn(),
  taskScheduleOccurrenceFindFirstMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  vendorGrantFindUniqueMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
}));

vi.mock("@sokosumi/database/helpers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/helpers")>();
  return {
    ...actual,
    hasAssignedOrganizationSeat: (...args: unknown[]) =>
      hasAssignedOrganizationSeatMock(...args),
  };
});

vi.mock("@sokosumi/database/repositories", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/repositories")>();
  return {
    ...actual,
    workspaceRepository: {
      resolveWorkspaceForContext: (...args: unknown[]) =>
        resolveWorkspaceForContextMock(...args),
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  default: {
    coworker: { findFirst: coworkerFindFirstMock },
    project: { findMany: projectFindManyMock },
    task: { findFirst: taskFindFirstMock },
    taskScheduleOccurrence: { findFirst: taskScheduleOccurrenceFindFirstMock },
    user: { findUnique: userFindUniqueMock },
    vendorGrant: { findUnique: vendorGrantFindUniqueMock },
    workspace: { findUnique: workspaceFindUniqueMock },
  },
}));

vi.mock("@/middleware/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/middleware/auth")>()),
  authMiddleware: (await import("@/test-fixtures/auth-middleware"))
    .stubAuthMiddleware,
}));

const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";
const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};
const COWORKER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "coworker_123",
  vendorId: "vendor_123",
  context: {
    userId: "user_123",
    organizationId: null,
  },
};
const UNBOUND_COWORKER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "coworker_123",
  vendorId: "vendor_123",
};

let mountGetWorkspaceCalendarSources: (app: OpenAPIHonoWithAuth) => void;

function createApp(authContext: AuthenticationContext = USER_AUTH_CONTEXT) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("requestId", "req_calendar_sources");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
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
    coworkerFindFirstMock.mockResolvedValue({ id: "coworker_123" });
    hasAssignedOrganizationSeatMock.mockResolvedValue(true);
    userFindUniqueMock.mockResolvedValue({ email: "ada@nmkr.io" });
    resolveWorkspaceForContextMock.mockResolvedValue({ id: WORKSPACE_ID });
    workspaceFindUniqueMock.mockResolvedValue({
      organization: null,
      user: { name: "Ada Lovelace", image: "https://example.com/ada.png" },
    });
    projectFindManyMock.mockResolvedValue([]);
    taskScheduleOccurrenceFindFirstMock.mockResolvedValue(null);
    taskFindFirstMock.mockResolvedValue(null);
    vendorGrantFindUniqueMock.mockResolvedValue({ status: "GRANTED" });
  });

  it("lists workspace and Project sources with their scheduling availability", async () => {
    projectFindManyMock.mockResolvedValue([
      {
        id: "22222222-2222-7222-8222-222222222222",
        name: "Alpha",
        logo: "https://example.com/alpha.png",
        closingAt: null,
        closedAt: null,
      },
      {
        id: "33333333-3333-7333-8333-333333333333",
        name: "Closing",
        logo: null,
        closingAt: new Date("2026-01-01T00:00:00.000Z"),
        closedAt: null,
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
          isSchedulable: true,
        },
        {
          sourceId: "project:22222222-2222-7222-8222-222222222222",
          sourceType: "PROJECT",
          displayName: "Alpha",
          logoUrl: "https://example.com/alpha.png",
          paletteToken: "violet",
          isSchedulable: true,
        },
        {
          sourceId: "project:33333333-3333-7333-8333-333333333333",
          sourceType: "PROJECT",
          displayName: "Closing",
          logoUrl: null,
          paletteToken: "violet",
          isSchedulable: false,
        },
      ],
      meta: expect.objectContaining({ requestId: "req_calendar_sources" }),
    });
    expect(projectFindManyMock).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        logo: true,
        closingAt: true,
        closedAt: true,
      },
    });
  });

  it("keeps a closed Project source unschedulable when it was never closing", async () => {
    projectFindManyMock.mockResolvedValue([
      {
        id: "44444444-4444-7444-8444-444444444444",
        name: "Zeta",
        logo: null,
        closingAt: null,
        closedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);

    const response = await createApp().request(
      "http://localhost/calendar/sources",
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toContainEqual({
      sourceId: "project:44444444-4444-7444-8444-444444444444",
      sourceType: "PROJECT",
      displayName: "Zeta",
      logoUrl: null,
      paletteToken: "violet",
      isSchedulable: false,
    });
  });

  it("lists schedulable sources for a coworker with granted workspace access", async () => {
    const response = await createApp(COWORKER_AUTH_CONTEXT).request(
      "http://localhost/calendar/sources",
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: `workspace:${WORKSPACE_ID}`,
          isSchedulable: true,
        }),
      ]),
    );
  });

  it.each([
    [
      "has no assigned organization seat",
      USER_AUTH_CONTEXT,
      () => {
        hasAssignedOrganizationSeatMock.mockResolvedValue(false);
      },
    ],
    [
      "lacks the tasks capability",
      COWORKER_AUTH_CONTEXT,
      () => {
        coworkerFindFirstMock.mockResolvedValue(null);
      },
    ],
  ])(
    "keeps sources visible but unschedulable when the caller %s",
    async (_reason, authContext, deny) => {
      projectFindManyMock.mockResolvedValue([
        {
          id: "22222222-2222-7222-8222-222222222222",
          name: "Alpha",
          logo: null,
          closingAt: null,
          closedAt: null,
        },
      ]);
      deny();

      const response = await createApp(authContext).request(
        "http://localhost/calendar/sources",
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sourceId: `workspace:${WORKSPACE_ID}`,
            isSchedulable: false,
          }),
          expect.objectContaining({
            sourceId: "project:22222222-2222-7222-8222-222222222222",
            isSchedulable: false,
          }),
        ]),
      );
    },
  );

  it("rejects a coworker without workspace access before loading sources", async () => {
    vendorGrantFindUniqueMock.mockResolvedValue(null);

    const response = await createApp(COWORKER_AUTH_CONTEXT).request(
      "http://localhost/calendar/sources",
    );

    expect(response.status).toBe(403);
    expect(userFindUniqueMock).not.toHaveBeenCalled();
    expect(workspaceFindUniqueMock).not.toHaveBeenCalled();
    expect(projectFindManyMock).not.toHaveBeenCalled();
  });

  it("rejects an unbound coworker before loading sources", async () => {
    const response = await createApp(UNBOUND_COWORKER_AUTH_CONTEXT).request(
      "http://localhost/calendar/sources",
    );

    expect(response.status).toBe(403);
    expect(userFindUniqueMock).not.toHaveBeenCalled();
    expect(workspaceFindUniqueMock).not.toHaveBeenCalled();
    expect(projectFindManyMock).not.toHaveBeenCalled();
  });

  it("rejects non-NMKR users before reading sources", async () => {
    userFindUniqueMock.mockResolvedValue({ email: "ada@example.com" });

    const response = await createApp().request(
      "http://localhost/calendar/sources",
    );

    expect(response.status).toBe(403);
    expect(workspaceFindUniqueMock).not.toHaveBeenCalled();
    expect(projectFindManyMock).not.toHaveBeenCalled();
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
      isSchedulable: false,
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
