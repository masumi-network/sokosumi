import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import { newsletterWorkspace } from "@/test/newsletter";

const {
  coworkerFindFirstMock,
  hasAssignedOrganizationSeatMock,
  memberFindFirstMock,
  projectFindManyMock,
  resolveWorkspaceForContextMock,
  taskFindFirstMock,
  vendorGrantFindUniqueMock,
  workspaceFindUniqueMock,
  socialPostGroupByMock,
  newsletterIssueGroupByMock,
  newsletterEnabledMock,
} = vi.hoisted(() => ({
  coworkerFindFirstMock: vi.fn(),
  hasAssignedOrganizationSeatMock: vi.fn(),
  memberFindFirstMock: vi.fn(),
  projectFindManyMock: vi.fn(),
  resolveWorkspaceForContextMock: vi.fn(),
  taskFindFirstMock: vi.fn(),
  vendorGrantFindUniqueMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
  socialPostGroupByMock: vi.fn(),
  newsletterIssueGroupByMock: vi.fn(),
  newsletterEnabledMock: vi.fn(),
}));

vi.mock("@/lib/newsletter/feature", () => ({
  isNewsletterWorkspaceEnabled: newsletterEnabledMock,
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
    member: { findFirst: memberFindFirstMock },
    project: { findMany: projectFindManyMock },
    task: { findFirst: taskFindFirstMock },
    vendorGrant: { findUnique: vendorGrantFindUniqueMock },
    workspace: { findUnique: workspaceFindUniqueMock },
    socialPost: { groupBy: socialPostGroupByMock },
    newsletterIssue: { groupBy: newsletterIssueGroupByMock },
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
  authenticationMethod: "session",
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
    memberFindFirstMock.mockResolvedValue({ id: "member_123" });
    resolveWorkspaceForContextMock.mockResolvedValue({ id: WORKSPACE_ID });
    workspaceFindUniqueMock.mockResolvedValue({
      organization: null,
      user: { name: "Ada Lovelace", image: "https://example.com/ada.png" },
    });
    projectFindManyMock.mockResolvedValue([]);
    taskFindFirstMock.mockResolvedValue(null);
    vendorGrantFindUniqueMock.mockResolvedValue({ status: "GRANTED" });
    socialPostGroupByMock.mockResolvedValue([]);
    newsletterIssueGroupByMock.mockResolvedValue([]);
    newsletterEnabledMock.mockResolvedValue(false);
  });

  it.each(["utxo", "other", null])(
    "only exposes newsletter sources for the beta workspace: %s",
    async (slug) => {
      newsletterEnabledMock.mockResolvedValue(slug === "utxo");
      const workspace = newsletterWorkspace(slug);
      workspaceFindUniqueMock.mockResolvedValue({
        ...workspace,
        user: { name: "Ada", image: null },
      });
      const projectId = "22222222-2222-7222-8222-222222222222";
      projectFindManyMock.mockResolvedValue([
        {
          id: projectId,
          name: "Project",
          logo: null,
          closingAt: null,
          closedAt: null,
        },
      ]);
      const at = new Date("2027-01-20T12:00:00.000Z");
      newsletterIssueGroupByMock.mockResolvedValue([
        { projectId, _max: { scheduledAt: at } },
      ]);
      const response = await createApp().request(
        "http://localhost/calendar/sources?includeSocialPosts=true",
      );
      expect(response.status).toBe(200);
      const { data } = await response.json();
      expect(newsletterEnabledMock).toHaveBeenCalledWith(WORKSPACE_ID);
      if (slug === "utxo") {
        expect(data[1]).toHaveProperty(
          "latestScheduledNewsletterIssueAt",
          at.toISOString(),
        );
      } else {
        expect(data[1]).not.toHaveProperty("latestScheduledNewsletterIssueAt");
        expect(newsletterIssueGroupByMock).not.toHaveBeenCalled();
      }
    },
  );

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
    [
      "reaches the member through a baseline Task but has no workspace grant",
      COWORKER_AUTH_CONTEXT,
      () => {
        vendorGrantFindUniqueMock.mockResolvedValue(null);
        taskFindFirstMock.mockResolvedValue({ id: "task_baseline" });
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
    expect(memberFindFirstMock).not.toHaveBeenCalled();
    expect(workspaceFindUniqueMock).not.toHaveBeenCalled();
    expect(projectFindManyMock).not.toHaveBeenCalled();
  });

  it("rejects an unbound coworker before loading sources", async () => {
    const response = await createApp(UNBOUND_COWORKER_AUTH_CONTEXT).request(
      "http://localhost/calendar/sources",
    );

    expect(response.status).toBe(403);
    expect(memberFindFirstMock).not.toHaveBeenCalled();
    expect(workspaceFindUniqueMock).not.toHaveBeenCalled();
    expect(projectFindManyMock).not.toHaveBeenCalled();
  });

  it("serves a user who belongs to no beta organization", async () => {
    memberFindFirstMock.mockResolvedValue(null);

    const response = await createApp().request(
      "http://localhost/calendar/sources",
    );

    expect(response.status).toBe(200);
    expect(workspaceFindUniqueMock).toHaveBeenCalled();
    expect(socialPostGroupByMock).not.toHaveBeenCalled();
  });

  it.each(["workspace", "owned"])(
    "returns each project's latest scheduled post in %s scope",
    async (scope) => {
      const projectId = "22222222-2222-7222-8222-222222222222";
      const emptyProjectId = "33333333-3333-7333-8333-333333333333";
      projectFindManyMock.mockResolvedValue(
        [projectId, emptyProjectId].map((id) => ({
          id,
          name: "Project",
          logo: null,
          closingAt: null,
          closedAt: null,
        })),
      );
      socialPostGroupByMock.mockResolvedValue([
        {
          projectId,
          _max: { scheduledAt: new Date("2027-01-20T12:00:00.000Z") },
        },
      ]);

      const response = await createApp().request(
        `http://localhost/calendar/sources?includeSocialPosts=true&scope=${scope}`,
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data[0]).not.toHaveProperty("latestScheduledSocialPostAt");
      expect(body.data[1]).toMatchObject({
        sourceId: `project:${projectId}`,
        latestScheduledSocialPostAt: "2027-01-20T12:00:00.000Z",
      });
      expect(body.data[2]).toMatchObject({
        sourceId: `project:${emptyProjectId}`,
        latestScheduledSocialPostAt: null,
      });
      expect(socialPostGroupByMock).toHaveBeenCalledWith({
        by: ["projectId"],
        where: {
          workspaceId: WORKSPACE_ID,
          ...(scope === "owned" ? { scheduledByUserId: "user_123" } : {}),
          status: { in: ["SCHEDULED", "PUBLISHING"] },
          scheduledAt: { not: null },
        },
        _max: { scheduledAt: true },
      });
    },
  );

  it("reads Social post dates outside the Ads beta", async () => {
    memberFindFirstMock.mockResolvedValue(null);
    const response = await createApp().request(
      "http://localhost/calendar/sources?includeSocialPosts=true",
    );
    expect(response.status).toBe(200);
    expect(socialPostGroupByMock).toHaveBeenCalled();
    expect(workspaceFindUniqueMock).toHaveBeenCalled();
  });

  it("rejects coworker access to Social post dates", async () => {
    const response = await createApp(COWORKER_AUTH_CONTEXT).request(
      "http://localhost/calendar/sources?includeSocialPosts=true",
    );
    expect(response.status).toBe(403);
    expect(socialPostGroupByMock).not.toHaveBeenCalled();
  });

  it("rejects API-key access to Social post dates", async () => {
    const response = await createApp({
      ...USER_AUTH_CONTEXT,
      authenticationMethod: "api_key",
    }).request("http://localhost/calendar/sources?includeSocialPosts=true");
    expect(response.status).toBe(403);
    expect(socialPostGroupByMock).not.toHaveBeenCalled();
  });
});
