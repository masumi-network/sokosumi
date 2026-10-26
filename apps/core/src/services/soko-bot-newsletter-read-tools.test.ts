import type { SokoBotCapability } from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACTION_CAPABILITIES } from "@/lib/soko-bot/action-receipts";
import {
  NEWSLETTER,
  NEWSLETTER_ISSUE,
  NEWSLETTER_PROJECT_ID,
  NEWSLETTER_SUBSCRIBER,
  NEWSLETTER_WORKSPACE_ID,
} from "@/test/newsletter";

const m = vi.hoisted(() => ({
  access: vi.fn(),
  available: vi.fn(),
  newsletter: vi.fn(),
  counts: vi.fn(),
  subscribers: vi.fn(),
  issues: vi.fn(),
  issue: vi.fn(),
  analytics: vi.fn(),
  issueAnalytics: vi.fn(),
  approve: vi.fn(),
  schedule: vi.fn(),
  cancel: vi.fn(),
  receipt: vi.fn(),
  finish: vi.fn(),
  query: vi.fn(),
  reserve: vi.fn(),
  count: vi.fn(),
}));
vi.mock("@/config/env", () => ({
  getEnv: () => ({ NEWSLETTER_ENABLED: true }),
  getWebAppBaseUrl: () => "https://app.example.com",
}));
vi.mock("@/lib/db/prisma", () => ({
  default: { sokoBotToolCall: { findUnique: m.receipt, updateMany: m.finish } },
}));
vi.mock("@/lib/image-studio/access", () => ({
  requireProjectAccess: m.access,
}));
vi.mock("@/services/newsletter.service", () => ({
  getNewsletter: m.newsletter,
  countNewsletterSubscribers: m.counts,
  listNewsletterSubscribers: m.subscribers,
}));
vi.mock("@/services/newsletter-draft.service", () => ({
  isNewsletterDraftAvailable: m.available,
}));
vi.mock("@/services/newsletter-issues.service", () => ({
  listNewsletterIssues: m.issues,
  getNewsletterIssue: m.issue,
  approveNewsletterIssue: m.approve,
  scheduleNewsletterIssue: m.schedule,
  cancelNewsletterIssue: m.cancel,
}));
vi.mock("@/services/newsletter-analytics.service", () => ({
  getNewsletterAnalytics: m.analytics,
  getNewsletterIssueAnalytics: m.issueAnalytics,
}));
vi.mock("@/lib/db/transaction", () => ({
  serializableTransaction: async (
    operation: (tx: unknown) => Promise<unknown>,
  ) =>
    operation({
      $queryRaw: m.query,
      sokoBotToolCall: {
        findUnique: m.receipt,
        create: m.reserve,
        count: m.count,
      },
    }),
}));

import {
  type AuthorizedSokoBotRuntime,
  SokoBotRuntimeService,
} from "./soko-bot-runtime.service";

const BOT_ID = "77777777-7777-4777-8777-777777777777";
const PAGINATION = {
  cursor: null,
  nextCursor: null,
  total: 1,
  limit: 20,
};
const TOTALS = {
  sent: 10,
  delivered: 9,
  uniqueOpens: 5,
  uniqueClicks: 2,
  unsubscribes: null,
  bounces: 1,
  complaints: 0,
  openRate: 5 / 9,
  clickRate: 2 / 9,
  activeSubscribers: 8,
};
const AUTHORIZED: AuthorizedSokoBotRuntime = {
  turn: {
    id: "turn",
    sokoBotId: BOT_ID,
    actingUserId: "user",
    requestedByUserId: "user",
    workspaceId: NEWSLETTER_WORKSPACE_ID,
    eveSessionId: "session",
    versionId: null,
    source: "CHAT",
    chainDepth: 0,
  },
  grant: {
    userId: "user",
    sokoBotId: BOT_ID,
    workspaceId: NEWSLETTER_WORKSPACE_ID,
    issuer: "core",
    audience: "soko-bot",
    subject: BOT_ID,
    jwtId: "grant",
    sessionId: "session",
    turnId: "turn",
    contextSnapshotId: "snapshot",
    memoryRevisionId: null,
    memoryVersion: 0,
    capabilities: [
      "get_newsletter",
      "list_newsletter_issues",
      "get_newsletter_issue",
      "get_newsletter_analytics",
      "list_newsletter_subscribers",
    ],
    issuedAt: 0,
    expiresAt: Date.now() + 60_000,
  },
  reader: { userId: "user", audience: "OWNER", sharedScope: null },
  classificationConfidence: 1,
  toolCallLimit: 10,
  askedByKind: "OWNER",
};
const SHARED_READER = {
  userId: "user",
  audience: "TEAMMATE" as const,
  sharedScope: {
    sokoBotId: BOT_ID,
    workspaceId: NEWSLETTER_WORKSPACE_ID,
    projectId: NEWSLETTER_PROJECT_ID,
  },
};

function execute(
  capability: SokoBotCapability,
  input: Record<string, unknown> = {},
  authorized = AUTHORIZED,
) {
  const runtime = new SokoBotRuntimeService();
  vi.spyOn(runtime, "authorize").mockResolvedValue(authorized);
  return runtime.executeTool({
    sessionId: "session",
    turnId: "turn",
    toolCallId: `call-${capability}`,
    capability,
    input: { projectId: NEWSLETTER_PROJECT_ID, ...input },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  m.access.mockResolvedValue({
    projectId: NEWSLETTER_PROJECT_ID,
    workspaceId: NEWSLETTER_WORKSPACE_ID,
    userId: "user",
    organizationId: null,
  });
  m.available.mockResolvedValue(true);
  m.newsletter.mockResolvedValue(NEWSLETTER);
  m.counts.mockResolvedValue({
    PENDING: 1,
    ACTIVE: 8,
    UNSUBSCRIBED: 2,
    BOUNCED: 0,
  });
  m.receipt.mockResolvedValue(null);
  m.finish.mockResolvedValue({ count: 1 });
  m.count.mockResolvedValue(0);
});

describe("Soko Bot newsletter read tools", () => {
  it("reads settings with the public signup page, archive and embed code", async () => {
    const result = await execute("get_newsletter");
    expect(result).toEqual({
      id: NEWSLETTER.id,
      projectId: NEWSLETTER_PROJECT_ID,
      name: "Weekly News",
      senderName: "Ada",
      replyTo: "ada@example.com",
      brand: {},
      welcomeEmailEnabled: false,
      welcomeSubject: null,
      welcomeBody: null,
      publicSlug: NEWSLETTER.publicSlug,
      signupUrl: `https://app.example.com/n/${NEWSLETTER.publicSlug}`,
      archiveUrl: `https://app.example.com/n/${NEWSLETTER.publicSlug}/archive`,
      embedHtml: expect.stringContaining(
        `src="https://app.example.com/n/${NEWSLETTER.publicSlug}/embed"`,
      ),
      subscriberCounts: { PENDING: 1, ACTIVE: 8, UNSUBSCRIBED: 2, BOUNCED: 0 },
    });
    expect(m.counts).toHaveBeenCalledWith(NEWSLETTER.id);
  });

  it("lists issues compactly with their creator, passing the filter and page", async () => {
    m.issues.mockResolvedValue({
      issues: [
        { ...NEWSLETTER_ISSUE, approvedByName: null, creatorSokoBotId: BOT_ID },
      ],
      pagination: PAGINATION,
    });
    const result = await execute("list_newsletter_issues", {
      status: "DRAFT",
      limit: 5,
    });
    expect(m.issues).toHaveBeenCalledWith(
      {
        projectId: NEWSLETTER_PROJECT_ID,
        workspaceId: NEWSLETTER_WORKSPACE_ID,
      },
      { status: "DRAFT", limit: 5 },
    );
    expect(result).toEqual({
      issues: [
        {
          id: NEWSLETTER_ISSUE.id,
          subject: NEWSLETTER_ISSUE.subject,
          status: "DRAFT",
          scheduledAt: null,
          sentAt: null,
          revision: 0,
          approvedByName: null,
          createdAt: NEWSLETTER_ISSUE.createdAt.toISOString(),
          createdBy: { kind: "soko_bot", id: BOT_ID },
        },
      ],
      pagination: PAGINATION,
    });
  });

  it.each([
    ["DRAFT", null, ["edit", "submit_for_approval", "delete"], []],
    ["NEEDS_APPROVAL", null, ["edit"], ["approve"]],
    ["NEEDS_APPROVAL", new Date(), ["edit"], ["schedule", "send_now"]],
    ["SCHEDULED", new Date(), [], ["unschedule"]],
    ["SENT", new Date(), [], []],
  ] as const)(
    "reads a %s issue in full and says which steps need a human",
    async (status, approvedAt, actions, humanOnlyActions) => {
      m.issue.mockResolvedValue({
        ...NEWSLETTER_ISSUE,
        status,
        approvedAt,
        approvedByUserId: approvedAt ? "approver" : null,
        approvedByName: approvedAt ? "Grace" : null,
        creatorUserId: "user",
      });
      const result = await execute("get_newsletter_issue", {
        issueId: NEWSLETTER_ISSUE.id,
      });
      expect(result).toMatchObject({
        id: NEWSLETTER_ISSUE.id,
        subject: NEWSLETTER_ISSUE.subject,
        template: "TEXT",
        content: NEWSLETTER_ISSUE.content,
        previewText: null,
        revision: 0,
        status,
        createdBy: { kind: "user", id: "user" },
        actions,
        humanOnlyActions,
        url: `/projects/${NEWSLETTER_PROJECT_ID}/newsletter/issues/${NEWSLETTER_ISSUE.id}`,
      });
      expect(result).not.toHaveProperty("workspaceId");
      expect(result).not.toHaveProperty("approvedByUserId");
      expect(m.approve).not.toHaveBeenCalled();
      expect(m.schedule).not.toHaveBeenCalled();
      expect(m.cancel).not.toHaveBeenCalled();
    },
  );

  it("reads newsletter analytics for a date range", async () => {
    const analytics = {
      from: "2026-10-01",
      to: "2026-10-26",
      totals: TOTALS,
      subscriberGrowth: [],
      engagement: [],
      issuesPagination: PAGINATION,
      issues: [],
    };
    m.analytics.mockResolvedValue(analytics);
    const result = await execute("get_newsletter_analytics", {
      from: "2026-10-01",
      to: "2026-10-26",
    });
    expect(m.analytics).toHaveBeenCalledWith(
      {
        projectId: NEWSLETTER_PROJECT_ID,
        workspaceId: NEWSLETTER_WORKSPACE_ID,
      },
      { from: "2026-10-01", to: "2026-10-26", limit: 10 },
    );
    expect(m.issueAnalytics).not.toHaveBeenCalled();
    expect(result).toEqual(analytics);
  });

  it("reads one issue's analytics when given an issueId", async () => {
    const analytics = {
      totals: TOTALS,
      topLinks: [{ url: "https://example.com", uniqueClicks: 2 }],
    };
    m.issueAnalytics.mockResolvedValue(analytics);
    const result = await execute("get_newsletter_analytics", {
      issueId: NEWSLETTER_ISSUE.id,
    });
    expect(m.issueAnalytics).toHaveBeenCalledWith(
      {
        projectId: NEWSLETTER_PROJECT_ID,
        workspaceId: NEWSLETTER_WORKSPACE_ID,
      },
      NEWSLETTER_ISSUE.id,
    );
    expect(m.analytics).not.toHaveBeenCalled();
    expect(result).toEqual(analytics);
  });

  it("lists subscribers for the owner with search, status and counts", async () => {
    const counts = { PENDING: 0, ACTIVE: 1, UNSUBSCRIBED: 0, BOUNCED: 0 };
    m.subscribers.mockResolvedValue({
      subscribers: [{ ...NEWSLETTER_SUBSCRIBER, contact: null }],
      counts,
      pagination: PAGINATION,
    });
    const result = await execute("list_newsletter_subscribers", {
      status: "ACTIVE",
      search: "reader",
    });
    expect(m.subscribers).toHaveBeenCalledWith(
      {
        projectId: NEWSLETTER_PROJECT_ID,
        workspaceId: NEWSLETTER_WORKSPACE_ID,
      },
      { status: "ACTIVE", search: "reader", limit: 20 },
    );
    expect(result).toEqual({
      subscribers: [
        {
          id: NEWSLETTER_SUBSCRIBER.id,
          email: "reader@example.com",
          name: null,
          contact: null,
          status: "ACTIVE",
          source: "MANUAL",
          confirmedAt: null,
          unsubscribedAt: null,
          createdAt: NEWSLETTER_SUBSCRIBER.createdAt.toISOString(),
        },
      ],
      counts,
      pagination: PAGINATION,
    });
  });

  it("records reads without an action receipt", () => {
    for (const capability of [
      "get_newsletter",
      "list_newsletter_issues",
      "get_newsletter_issue",
      "get_newsletter_analytics",
      "list_newsletter_subscribers",
    ])
      expect(ACTION_CAPABILITIES.has(capability)).toBe(false);
  });

  it.each([
    "get_newsletter",
    "list_newsletter_issues",
    "get_newsletter_analytics",
    "list_newsletter_subscribers",
  ] as const)(
    "refuses %s outside a project bot's own Project",
    async (capability) => {
      await expect(
        execute(
          capability,
          { projectId: "99999999-9999-4999-8999-999999999999" },
          { ...AUTHORIZED, reader: SHARED_READER },
        ),
      ).rejects.toThrow("own Project");
      expect(m.access).not.toHaveBeenCalled();
      expect(m.newsletter).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    "refuses every read while the newsletter is unavailable, even on replay (replay=%s)",
    async (replay) => {
      m.available.mockResolvedValue(false);
      if (replay)
        m.receipt.mockResolvedValue({
          capability: "get_newsletter",
          status: "COMPLETED",
          result: { name: "Weekly News" },
        });
      await expect(execute("get_newsletter")).rejects.toThrow(
        "Newsletter is not enabled",
      );
      expect(m.available).toHaveBeenCalledWith({
        projectId: NEWSLETTER_PROJECT_ID,
        workspaceId: NEWSLETTER_WORKSPACE_ID,
      });
      expect(m.newsletter).not.toHaveBeenCalled();
      expect(m.receipt).not.toHaveBeenCalled();
    },
  );

  it("refuses a project the acting member cannot access", async () => {
    m.access.mockRejectedValue(new Error("Project not found"));
    await expect(execute("list_newsletter_issues")).rejects.toThrow(
      "Project not found",
    );
    expect(m.issues).not.toHaveBeenCalled();
  });

  it("requires an existing newsletter", async () => {
    m.newsletter.mockRejectedValue(new Error("Newsletter not found"));
    await expect(execute("get_newsletter_analytics")).rejects.toThrow(
      "Newsletter not found",
    );
    expect(m.analytics).not.toHaveBeenCalled();
  });

  it.each([
    ["a shared bot", { ...AUTHORIZED, reader: SHARED_READER }],
    ["a teammate's request", { ...AUTHORIZED, askedByKind: "TEAMMATE" }],
  ] as const)("keeps subscriber emails from %s", async (_label, authorized) => {
    await expect(
      execute("list_newsletter_subscribers", {}, authorized),
    ).rejects.toThrow("personal data");
    expect(m.subscribers).not.toHaveBeenCalled();
  });

  it("lets a shared project bot read its own newsletter settings", async () => {
    await expect(
      execute("get_newsletter", {}, { ...AUTHORIZED, reader: SHARED_READER }),
    ).resolves.toMatchObject({ name: "Weekly News" });
  });
});
