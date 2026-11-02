import { NEWSLETTER_BETA_ORGANIZATION_SLUG } from "@sokosumi/utils";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

const mocks = vi.hoisted(() => ({
  hasAssignedOrganizationSeat: vi.fn(),
  resolveWorkspaceForContext: vi.fn(),
  coworkerFindFirst: vi.fn(),
  projectFindFirst: vi.fn(),
  runs: vi.fn(),
  runCount: vi.fn(),
  tasks: vi.fn(),
  taskCount: vi.fn(),
  posts: vi.fn(),
  postCount: vi.fn(),
  workspaceFindUnique: vi.fn(),
  issues: vi.fn(),
  contacts: vi.fn(),
  strategies: vi.fn(),
  strategyFiles: vi.fn(),
  botSchedules: vi.fn(),
}));

vi.mock("@/middleware/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/middleware/auth")>()),
  authMiddleware: (await import("@/test-fixtures/auth-middleware"))
    .stubAuthMiddleware,
}));
vi.mock("@sokosumi/database/helpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sokosumi/database/helpers")>()),
  hasAssignedOrganizationSeat: mocks.hasAssignedOrganizationSeat,
}));
vi.mock("@sokosumi/database/repositories", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sokosumi/database/repositories")>()),
  workspaceRepository: {
    resolveWorkspaceForContext: mocks.resolveWorkspaceForContext,
  },
}));
vi.mock(
  "@/helpers/coworker-user-context-binding",
  async () =>
    await vi.importActual<
      typeof import("@/helpers/coworker-user-context-binding")
    >("@/helpers/coworker-user-context-binding"),
);
vi.mock("@/lib/db/prisma", () => ({
  default: {
    coworker: { findFirst: mocks.coworkerFindFirst },
    member: { findFirst: async () => ({ id: "member_123" }) },
    vendorGrant: { findUnique: async () => null },
    project: { findFirst: mocks.projectFindFirst },
    taskScheduleRun: { findMany: mocks.runs, count: mocks.runCount },
    task: {
      findMany: mocks.tasks,
      count: mocks.taskCount,
      findFirst: async () => ({ id: "tsk_baseline" }),
    },
    socialPost: {
      findMany: mocks.posts,
      count: mocks.postCount,
      aggregate: async () => ({ _max: { scheduledAt: null } }),
    },
    workspace: { findUnique: mocks.workspaceFindUnique },
    newsletterIssue: { findMany: mocks.issues },
    contact: { findMany: mocks.contacts },
    marketingStrategy: { findMany: mocks.strategies },
    marketingStrategyFile: { findMany: mocks.strategyFiles },
    sokoBotSchedule: { findMany: mocks.botSchedules },
  },
}));

const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";
const PROJECT_ID = "22222222-2222-7222-8222-222222222222";
const RUN_ID = "00000000-0000-7000-8000-000000000001";
const POST_ID = "33333333-3333-7333-8333-333333333333";
const ISSUE_ID = "44444444-4444-7444-8444-444444444444";
const SENT_ISSUE_ID = "44444444-4444-7444-8444-444444444445";
const CONTACT_ID = "55555555-5555-7555-8555-555555555555";
const STRATEGY_ID = "66666666-6666-7666-8666-666666666666";
const FROM = "2026-06-01T00:00:00.000Z";
const TO = "2026-06-08T00:00:00.000Z";
const TIE = "2026-06-03T00:00:00.000Z";
const ALL_TYPES = "tasks,social,newsletter,contacts,marketing";

const USER: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
  authenticationMethod: "session",
};
const COWORKER: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "coworker_123",
  vendorId: "vendor_123",
  context: { userId: "user_123", organizationId: null },
};

const run = {
  id: RUN_ID,
  originalScheduledAt: new Date(TIE),
  effectiveScheduledAt: new Date(TIE),
  state: "PLANNED",
  sourceWorkspaceId: WORKSPACE_ID,
  sourceType: "PROJECT",
  sourceProjectId: PROJECT_ID,
  schedule: {
    id: "77777777-7777-7777-8777-777777777777",
    name: "Weekly report",
    ownerId: "user_123",
    visibility: "PUBLIC",
    state: "ACTIVE",
    revision: 4,
    creatorCoworkerId: null,
    assigneeId: null,
    assigneeUserId: null,
    assignee: null,
  },
  releasedTask: null,
};
const post = {
  id: POST_ID,
  provider: "x",
  text: "Launch",
  status: "SCHEDULED",
  revision: 1,
  scheduledAt: new Date(TIE),
  projectId: PROJECT_ID,
  workspaceId: WORKSPACE_ID,
  socialConnection: null,
  project: { name: "Launch project" },
  scheduledByUser: null,
  attempts: [],
  threadParts: [],
  quotedPostId: null,
  quotedPost: null,
  needsAttentionReason: null,
  publishedExternalId: null,
  publishingThreadPartPosition: null,
  lastError: null,
  media: [],
};
const issue = {
  id: ISSUE_ID,
  subject: "June update",
  status: "SCHEDULED",
  scheduledAt: new Date(TIE),
  sentAt: null,
  projectId: PROJECT_ID,
  workspaceId: WORKSPACE_ID,
  project: { name: "Launch project" },
};
const contact = {
  id: CONTACT_ID,
  name: "Ada Lovelace",
  organization: "Analytical Engines",
  avatarUrl: null,
  nextStep: "Send the offer",
  followUpAt: new Date("2026-06-03"),
  workspaceId: WORKSPACE_ID,
};
const entry = (patch: Record<string, unknown>) => ({
  id: "e1",
  date: "2026-06-03",
  time: "00:00",
  channel: "newsletter",
  title: "June newsletter",
  format: "newsletter",
  status: "draft",
  ...patch,
});
const strategy = (calendar: unknown[]) => ({
  id: STRATEGY_ID,
  projectId: PROJECT_ID,
  project: { name: "Launch project" },
  plan: {
    month: "2026-06",
    summary: "Plan",
    goals: ["Grow"],
    pillars: [],
    channels: [],
    calendar,
  },
});

let mount: (app: OpenAPIHonoWithAuth) => void;

function createApp(authContext: AuthenticationContext = USER) {
  const app = new OpenAPIHonoWithAuth();
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    c.set("requestId", "req_calendar");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", {
      workspaceId: WORKSPACE_ID,
      userId: "user_123",
      organizationId: null,
    });
    return await next();
  });
  mount(app);
  return app;
}

async function get(query: string, authContext?: AuthenticationContext) {
  const response = await createApp(authContext).request(
    `http://localhost/calendar?from=${FROM}&to=${TO}&${query}`,
  );
  return { status: response.status, body: await response.json() };
}

const ids = (body: { data: { id: string }[] }) => body.data.map((i) => i.id);

describe("GET /workspaces/calendar types", () => {
  beforeAll(async () => {
    mount = (await import("./get")).default;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-01T12:00:00.000Z"));
    mocks.hasAssignedOrganizationSeat.mockResolvedValue(true);
    mocks.resolveWorkspaceForContext.mockResolvedValue({ id: WORKSPACE_ID });
    mocks.coworkerFindFirst.mockResolvedValue({ id: "coworker_123" });
    mocks.projectFindFirst.mockResolvedValue({ id: PROJECT_ID });
    mocks.runs.mockResolvedValue([]);
    mocks.runCount.mockResolvedValue(0);
    mocks.tasks.mockResolvedValue([]);
    mocks.taskCount.mockResolvedValue(0);
    mocks.posts.mockResolvedValue([]);
    mocks.postCount.mockResolvedValue(0);
    mocks.workspaceFindUnique.mockResolvedValue({
      organization: { slug: NEWSLETTER_BETA_ORGANIZATION_SLUG },
    });
    mocks.issues.mockResolvedValue([]);
    mocks.contacts.mockResolvedValue([]);
    mocks.strategies.mockResolvedValue([]);
    mocks.strategyFiles.mockResolvedValue([]);
    mocks.botSchedules.mockResolvedValue([]);
  });

  const featureReads = () => [
    mocks.posts,
    mocks.issues,
    mocks.contacts,
    mocks.strategies,
  ];

  it("reads only Tasks without types, and Social posts when asked as before", async () => {
    mocks.runs.mockResolvedValue([run]);
    mocks.runCount.mockResolvedValue(1);
    const tasksOnly = await get("");
    expect(tasksOnly.status).toBe(200);
    expect(ids(tasksOnly.body)).toEqual([RUN_ID]);
    featureReads().forEach((read) => expect(read).not.toHaveBeenCalled());

    mocks.posts.mockResolvedValue([post]);
    mocks.postCount.mockResolvedValue(1);
    const withPosts = await get("includeSocialPosts=true");
    expect(ids(withPosts.body)).toEqual([RUN_ID, `social:${POST_ID}`]);
    expect(mocks.issues).not.toHaveBeenCalled();
    expect(mocks.contacts).not.toHaveBeenCalled();
    expect(mocks.strategies).not.toHaveBeenCalled();
  });

  it("returns exactly the requested types and ignores includeSocialPosts", async () => {
    mocks.runs.mockResolvedValue([run]);
    mocks.posts.mockResolvedValue([post]);
    const { body } = await get("types=social&includeSocialPosts=false");
    expect(ids(body)).toEqual([`social:${POST_ID}`]);
    expect(mocks.runs).not.toHaveBeenCalled();
    expect(mocks.tasks).not.toHaveBeenCalled();
  });

  it("shows Newsletter issues at their scheduled time, else their sent time", async () => {
    mocks.issues.mockResolvedValue([
      {
        ...issue,
        id: SENT_ISSUE_ID,
        status: "SENT",
        scheduledAt: null,
        sentAt: new Date("2026-06-02T08:00:00.000Z"),
      },
      issue,
    ]);
    const { status, body } = await get("types=newsletter");
    expect(status).toBe(200);
    expect(body.data).toEqual([
      {
        kind: "newsletterIssue",
        id: `newsletter:${SENT_ISSUE_ID}`,
        issueId: SENT_ISSUE_ID,
        subject: "June update",
        status: "SENT",
        projectName: "Launch project",
        sourceId: `project:${PROJECT_ID}`,
        sourceProjectId: PROJECT_ID,
        sourceWorkspaceId: WORKSPACE_ID,
        sourceType: "PROJECT",
        scheduledAt: "2026-06-02T08:00:00.000Z",
      },
      expect.objectContaining({
        id: `newsletter:${ISSUE_ID}`,
        status: "SCHEDULED",
        scheduledAt: TIE,
      }),
    ]);
    expect(body.meta.pagination.total).toBe(2);
    expect(mocks.issues.mock.lastCall?.[0].where).toEqual({
      workspaceId: WORKSPACE_ID,
      status: { notIn: ["DRAFT", "CANCELED"] },
      OR: [
        { scheduledAt: { gte: new Date(FROM), lt: new Date(TO) } },
        {
          scheduledAt: null,
          sentAt: { gte: new Date(FROM), lt: new Date(TO) },
        },
      ],
    });
  });

  it("returns no Newsletter issues when the workspace has no Newsletter", async () => {
    mocks.workspaceFindUnique.mockResolvedValue({
      organization: { slug: "other" },
    });
    mocks.issues.mockResolvedValue([issue]);
    const { body } = await get("types=newsletter");
    expect(body.data).toEqual([]);
    expect(body.meta.pagination.total).toBe(0);
    expect(mocks.issues).not.toHaveBeenCalled();
  });

  it("shows Contact follow-ups as all-day items at the start of their day", async () => {
    mocks.contacts.mockResolvedValue([contact]);
    const { body } = await get("types=contacts");
    expect(body.data).toEqual([
      {
        kind: "contactFollowUp",
        id: `followup:${CONTACT_ID}`,
        contactId: CONTACT_ID,
        name: "Ada Lovelace",
        organization: "Analytical Engines",
        avatarUrl: null,
        nextStep: "Send the offer",
        date: "2026-06-03",
        allDay: true,
        sourceId: `workspace:${WORKSPACE_ID}`,
        sourceType: "WORKSPACE",
        sourceProjectId: null,
        sourceWorkspaceId: WORKSPACE_ID,
        scheduledAt: TIE,
      },
    ]);
    expect(mocks.contacts.mock.lastCall?.[0].where).toEqual({
      workspaceId: WORKSPACE_ID,
      archivedAt: null,
      mergedIntoId: null,
      followUpAt: { gte: new Date("2026-06-01"), lte: new Date("2026-06-07") },
    });
  });

  it("places Contact follow-ups on the days of the requested timeZone", async () => {
    const dates = ["2026-05-30", "2026-05-31", "2026-06-07", "2026-06-08"];
    mocks.contacts.mockImplementation(async ({ where }) =>
      dates
        .map((d, i) => ({
          ...contact,
          id: `55555555-5555-7555-8555-55555555555${i}`,
          followUpAt: new Date(d),
        }))
        .filter(
          (c) =>
            c.followUpAt >= where.followUpAt.gte &&
            c.followUpAt <= where.followUpAt.lte,
        ),
    );
    const { body } = await get("types=contacts&timeZone=America/Sao_Paulo");
    expect(body.data.map((c: { date: string }) => c.date)).toEqual([
      "2026-05-31",
      "2026-06-07",
    ]);
    // Midnight in Sao Paulo is 03:00 UTC.
    expect(body.data[1].scheduledAt).toBe("2026-06-07T03:00:00.000Z");

    const utc = await get("types=contacts");
    expect(utc.body.data.map((c: { date: string }) => c.date)).toEqual([
      "2026-06-07",
    ]);
  });

  it("shows approved Marketing strategy pieces at the plan's time zone", async () => {
    mocks.strategies.mockResolvedValue([
      strategy([
        entry({
          id: "late",
          time: "10:30",
          channel: "seo",
          format: "article",
          status: "idea",
        }),
        entry({ id: "default-time", date: "2026-06-04", time: undefined }),
        entry({ id: "outside", date: "2026-06-09" }),
      ]),
    ]);
    mocks.botSchedules.mockResolvedValue([
      { timezone: "America/New_York", sokoBot: { projectId: PROJECT_ID } },
    ]);
    mocks.strategyFiles.mockResolvedValue([
      {
        marketingStrategyId: STRATEGY_ID,
        entryId: "late",
        fileResourceId: "file-1",
      },
    ]);
    const { body } = await get("types=marketing");
    expect(body.data).toEqual([
      {
        kind: "marketingPiece",
        id: `marketing:${STRATEGY_ID}:late`,
        strategyId: STRATEGY_ID,
        entryId: "late",
        title: "June newsletter",
        channel: "seo",
        format: "article",
        status: "idea",
        fileId: "file-1",
        projectName: "Launch project",
        sourceId: `project:${PROJECT_ID}`,
        sourceProjectId: PROJECT_ID,
        sourceWorkspaceId: WORKSPACE_ID,
        sourceType: "PROJECT",
        scheduledAt: "2026-06-03T14:30:00.000Z",
      },
      expect.objectContaining({
        entryId: "default-time",
        fileId: null,
        scheduledAt: "2026-06-04T13:00:00.000Z",
      }),
    ]);
    expect(body.meta.pagination.total).toBe(2);
    expect(mocks.strategies.mock.lastCall?.[0].where).toEqual({
      approvedAt: { not: null },
      project: { workspaceId: WORKSPACE_ID },
    });
    // One lookup for every Project, not one per entry.
    expect(mocks.botSchedules).toHaveBeenCalledTimes(1);
  });

  it("falls back to UTC and links only an active file for Marketing pieces", async () => {
    mocks.strategies.mockResolvedValue([
      strategy([entry({ id: "written", fileId: "deleted-file" })]),
    ]);
    const { body } = await get("types=marketing");
    expect(body.data[0]).toMatchObject({
      fileId: null,
      scheduledAt: TIE,
    });
  });

  it("includes a Marketing piece at from and leaves one at to out", async () => {
    mocks.strategies.mockResolvedValue([
      strategy([
        entry({ id: "at-from", date: "2026-06-01" }),
        entry({ id: "at-to", date: "2026-06-08" }),
      ]),
    ]);
    const { body } = await get("types=marketing");
    expect(body.data).toEqual([
      expect.objectContaining({ entryId: "at-from", scheduledAt: FROM }),
    ]);
  });

  it("leaves Social posts, skipped pieces and invalid plans out of the Marketing plan", async () => {
    mocks.strategies.mockResolvedValue([
      strategy([
        entry({ id: "piece" }),
        entry({ id: "made", socialPostId: POST_ID }),
        entry({ id: "post", channel: "linkedin", format: "post" }),
        entry({ id: "skipped", status: "skipped" }),
      ]),
      {
        ...strategy([entry({ id: "broken" })]),
        id: "broken",
        plan: { nope: 1 },
      },
    ]);
    const { body } = await get("types=marketing");
    expect(body.data.map((p: { entryId: string }) => p.entryId)).toEqual([
      "piece",
    ]);
  });

  it("merges every type in time order across pages, ties broken by id", async () => {
    mocks.runs.mockResolvedValue([run]);
    mocks.runCount.mockResolvedValue(1);
    mocks.posts.mockResolvedValue([post]);
    mocks.postCount.mockResolvedValue(1);
    mocks.issues.mockResolvedValue([issue]);
    mocks.contacts.mockResolvedValue([contact]);
    mocks.strategies.mockResolvedValue([strategy([entry({})])]);
    const query = `types=${ALL_TYPES}&limit=2`;

    const first = await get(query);
    expect(ids(first.body)).toEqual([RUN_ID, `followup:${CONTACT_ID}`]);
    expect(first.body.meta.pagination.total).toBe(5);

    // The databases hand back only what follows each cursor.
    mocks.runs.mockResolvedValue([]);
    const second = await get(
      `${query}&cursor=${first.body.meta.pagination.nextCursor}`,
    );
    expect(ids(second.body)).toEqual([
      `marketing:${STRATEGY_ID}:e1`,
      `newsletter:${ISSUE_ID}`,
    ]);
    expect(mocks.runs.mock.lastCall?.[0].where.AND.at(-1)).toEqual({
      OR: [{ effectiveScheduledAt: { gt: new Date(TIE) } }],
    });
    expect(mocks.posts.mock.lastCall?.[0].where.OR[1]).toEqual({
      scheduledAt: new Date(TIE),
    });

    const third = await get(
      `${query}&cursor=${second.body.meta.pagination.nextCursor}`,
    );
    expect(ids(third.body)).toEqual([`social:${POST_ID}`]);
    expect(third.body.meta.pagination.nextCursor).toBeNull();
  });

  it("limits Project-scoped types to the Project and drops Contacts", async () => {
    mocks.posts.mockResolvedValue([post]);
    mocks.issues.mockResolvedValue([issue]);
    mocks.strategies.mockResolvedValue([strategy([entry({})])]);
    mocks.contacts.mockResolvedValue([contact]);
    const { body } = await get(
      `types=social,newsletter,contacts,marketing&projectId=${PROJECT_ID}`,
    );
    expect(body.data).toHaveLength(3);
    expect(mocks.contacts).not.toHaveBeenCalled();
    expect(mocks.posts.mock.lastCall?.[0].where.projectId).toBe(PROJECT_ID);
    expect(mocks.issues.mock.lastCall?.[0].where.projectId).toBe(PROJECT_ID);
    expect(mocks.strategies.mock.lastCall?.[0].where.project).toEqual({
      workspaceId: WORKSPACE_ID,
      id: PROJECT_ID,
    });
  });

  it("shows only workspace-sourced items for a workspace source", async () => {
    mocks.contacts.mockResolvedValue([contact]);
    const { body } = await get(
      `types=${ALL_TYPES}&sourceId=workspace:${WORKSPACE_ID}`,
    );
    expect(ids(body)).toEqual([`followup:${CONTACT_ID}`]);
    expect(mocks.posts).not.toHaveBeenCalled();
    expect(mocks.issues).not.toHaveBeenCalled();
    expect(mocks.strategies).not.toHaveBeenCalled();
    expect(mocks.runs).toHaveBeenCalled();
  });

  it("rejects a foreign source for every type", async () => {
    const { status } = await get(
      "types=contacts&sourceId=workspace:44444444-4444-7444-8444-444444444445",
    );
    expect(status).toBe(404);
    expect(mocks.contacts).not.toHaveBeenCalled();
  });

  it("reads the caller's own items for scope=owned and no Marketing plan", async () => {
    await get(`types=${ALL_TYPES}&scope=owned`);
    expect(mocks.posts.mock.lastCall?.[0].where.scheduledByUserId).toBe(
      "user_123",
    );
    expect(mocks.issues.mock.lastCall?.[0].where.creatorUserId).toBe(
      "user_123",
    );
    expect(mocks.contacts.mock.lastCall?.[0].where.createdByUserId).toBe(
      "user_123",
    );
    expect(mocks.strategies).not.toHaveBeenCalled();
  });

  it.each([
    "status=READY",
    "assigneeId=22222222-2222-7222-8222-222222222223",
    "assigneeUserId=user_456",
  ])(
    "leaves every type but Tasks out for the task-only filter %s",
    async (filter) => {
      const { status } = await get(`types=${ALL_TYPES}&${filter}`);
      expect(status).toBe(200);
      featureReads().forEach((read) => expect(read).not.toHaveBeenCalled());
      expect(
        mocks.runs.mock.calls.length + mocks.tasks.mock.calls.length,
      ).toBeGreaterThan(0);
    },
  );

  it("shows only what is still to come in the agenda", async () => {
    mocks.issues.mockResolvedValue([issue]);
    mocks.strategies.mockResolvedValue([
      strategy([
        entry({ id: "idea", status: "idea" }),
        entry({ id: "out", status: "published" }),
      ]),
    ]);
    const { body } = await get("types=newsletter,marketing&agendaOnly=true");
    expect(body.data.map((i: { id: string }) => i.id)).toEqual([
      `marketing:${STRATEGY_ID}:idea`,
      `newsletter:${ISSUE_ID}`,
    ]);
    expect(mocks.issues.mock.lastCall?.[0].where.status).toEqual({
      in: ["NEEDS_APPROVAL", "SCHEDULED", "SENDING"],
    });
  });

  it("requires an interactive session for any type but tasks", async () => {
    for (const types of ["newsletter", "tasks,contacts", "marketing"]) {
      const { status } = await get(`types=${types}`, COWORKER);
      expect(status).toBe(403);
    }
    expect((await get("types=tasks", COWORKER)).status).toBe(200);
    expect((await get("types=contacts")).status).toBe(200);
  });

  it.each([
    ["types=events"],
    ["types="],
    ["types=tasks,events"],
    ["types=tasks&timeZone=Mars/Base"],
  ])("rejects the invalid query %s", async (query) => {
    const { status } = await get(query);
    expect(status).toBe(422);
    expect(mocks.runs).not.toHaveBeenCalled();
  });
});
