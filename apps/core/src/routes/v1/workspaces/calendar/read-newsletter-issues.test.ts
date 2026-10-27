import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseWorkspaceCalendarQuery, readWorkspaceCalendar } from "./read";

const m = vi.hoisted(() => ({
  latestIssue: vi.fn(),
  latestPost: vi.fn(),
  enabled: true,
  issues: vi.fn(),
  count: vi.fn(),
  posts: vi.fn(),
  runs: vi.fn(),
}));
vi.mock("@/lib/newsletter/feature", () => ({
  isNewsletterWorkspaceEnabled: async () => m.enabled,
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    taskScheduleRun: { findMany: m.runs, count: async () => 0 },
    task: { findMany: async () => [], count: async () => 0 },
    socialPost: {
      findMany: m.posts,
      count: async () => 0,
      aggregate: m.latestPost,
    },
    newsletterIssue: {
      findMany: m.issues,
      count: m.count,
      aggregate: m.latestIssue,
    },
  },
}));
const workspaceId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const issueId = "33333333-3333-4333-8333-333333333333";
const at = "2026-10-24T10:00:00.000Z";
const scheduled = {
  id: issueId,
  subject: "This week's news",
  status: "SCHEDULED",
  scheduledAt: new Date(at),
  sentAt: null,
  workspaceId,
  projectId,
};
const query = parseWorkspaceCalendarQuery({
  from: "2026-10-24T00:00:00Z",
  to: "2026-10-25T00:00:00Z",
  includeSocialPosts: "true",
  scope: "workspace",
  limit: 1,
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-23T10:00:00Z"));
  m.enabled = true;
  m.latestPost.mockResolvedValue({ _max: { scheduledAt: null } });
  m.latestIssue.mockResolvedValue({ _max: { scheduledAt: null } });
  m.posts.mockResolvedValue([]);
  m.runs.mockResolvedValue([]);
  m.issues.mockImplementation(async ({ where }) =>
    where.AND[0].scheduledAt === null ? [] : [scheduled],
  );
  m.count.mockImplementation(async ({ where }) =>
    where.scheduledAt === null ? 0 : 1,
  );
});
afterEach(() => vi.useRealTimers());

describe("newsletter issues on the project and Social calendar", () => {
  it("returns a newsletter kind and scope without issue content or subscriber data", async () => {
    const result = await readWorkspaceCalendar(workspaceId, "user_1", query, {
      projectId,
    });
    expect(result.items).toEqual([
      {
        kind: "newsletter_issue",
        id: `newsletter:${issueId}`,
        issueId,
        subject: scheduled.subject,
        status: "SCHEDULED",
        scheduledAt: at,
        sourceId: `project:${projectId}`,
        sourceWorkspaceId: workspaceId,
        sourceProjectId: projectId,
        sourceType: "PROJECT",
      },
    ]);
    expect(m.issues).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            expect.objectContaining({
              workspaceId,
              projectId,
              status: { in: ["SCHEDULED", "SENDING", "SENT"] },
            }),
            {},
          ],
        },
      }),
    );
    expect(result.pagination.total).toBe(1);
  });
  it("uses sentAt when a sent issue has no scheduledAt", async () => {
    m.issues.mockImplementation(async ({ where }) =>
      where.AND[0].scheduledAt === null
        ? [
            {
              ...scheduled,
              status: "SENT",
              scheduledAt: null,
              sentAt: new Date(at),
            },
          ]
        : [],
    );
    const result = await readWorkspaceCalendar(workspaceId, "user_1", query);
    expect(result.items[0]).toMatchObject({
      kind: "newsletter_issue",
      status: "SENT",
      scheduledAt: at,
    });
  });
  it("paginates newsletter and Social entries at the same time without repeating either", async () => {
    // A later id at the same time must page after a newsletter cursor.
    await readWorkspaceCalendar(workspaceId, "user_1", {
      ...query,
      cursor: { id: `newsletter:${issueId}`, scheduledAt: at },
    });
    expect(m.issues.mock.calls[0][0].where.AND[1].OR[1]).toEqual({
      scheduledAt: new Date(at),
      id: { gt: issueId },
    });
    m.issues.mockClear();
    await readWorkspaceCalendar(workspaceId, "user_1", {
      ...query,
      cursor: { id: `social:${issueId}`, scheduledAt: at },
    });
    expect(m.issues.mock.calls[0][0].where.AND[1].OR).toEqual([
      { scheduledAt: { gt: new Date(at) } },
    ]);
  });
  it("keeps owned scope tied to the human approver and excludes sent issues from the agenda", async () => {
    await readWorkspaceCalendar(workspaceId, "user_1", {
      ...query,
      scope: "owned",
      agendaOnly: true,
    });
    expect(m.issues).toHaveBeenCalledTimes(1);
    expect(m.issues.mock.calls[0][0].where.AND[0]).toMatchObject({
      approvedByUserId: "user_1",
      status: { in: ["SCHEDULED", "SENDING"] },
    });
  });
  it("allows browsing a scheduled newsletter beyond the normal 90-day horizon", async () => {
    m.latestIssue.mockResolvedValue({
      _max: { scheduledAt: new Date("2027-04-15T10:00:00Z") },
    });
    const future = {
      ...query,
      from: new Date("2027-04-01T00:00:00Z"),
      to: new Date("2027-05-01T00:00:00Z"),
    };
    await expect(
      readWorkspaceCalendar(workspaceId, "user_1", future, { projectId }),
    ).resolves.toHaveProperty("items");
    expect(m.latestIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId,
          project: { workspaceId },
          projectId,
          status: { in: ["SCHEDULED", "SENDING"] },
        },
      }),
    );
  });
  it("preserves task-only responses and hides newsletter data when disabled or task-filtered", async () => {
    for (const q of [
      { ...query, includeSocialPosts: false },
      { ...query, assigneeUserId: "other" },
    ]) {
      expect(
        (await readWorkspaceCalendar(workspaceId, "user_1", q)).items,
      ).toEqual([]);
    }
    m.enabled = false;
    expect(
      (await readWorkspaceCalendar(workspaceId, "user_1", query)).items,
    ).toEqual([]);
    expect(m.issues).not.toHaveBeenCalled();
  });
});
