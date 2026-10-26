import type { NewsletterIssue } from "@sokosumi/database";
import { SOKO_BOT_TOOL_INPUT_SCHEMAS } from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACTION_CAPABILITIES,
  EXTERNAL_EFFECT_CAPABILITIES,
} from "@/lib/soko-bot/action-receipts";
import { ACTION_LABELS } from "@/lib/soko-bot/action-response";
import {
  NEWSLETTER,
  NEWSLETTER_ISSUE,
  NEWSLETTER_ISSUE_ID,
  NEWSLETTER_PROJECT_ID,
  NEWSLETTER_WORKSPACE_ID,
} from "@/test/newsletter";

// The issue service runs for real against this in-memory issue, so the
// lifecycle rules under test are the ones the Newsletter UI gets.
const m = vi.hoisted(() => ({
  access: vi.fn(),
  available: vi.fn(),
  newsletter: vi.fn(),
  issue: { current: null as NewsletterIssue | null },
  issueCreate: vi.fn(),
  issueUpdate: vi.fn(),
  issueDelete: vi.fn(),
  ownerTurn: vi.fn(),
  receipt: vi.fn(),
  receiptUpdate: vi.fn(),
  finish: vi.fn(),
  turn: vi.fn(),
  workspace: vi.fn(),
  query: vi.fn(),
  reserve: vi.fn(),
  count: vi.fn(),
}));
vi.mock("@/config/env", () => ({
  getEnv: () => ({ NEWSLETTER_ENABLED: true }),
  getWebAppBaseUrl: () => "https://app.example.com",
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotToolCall: { findUnique: m.receipt, updateMany: m.finish },
    sokoBotTurn: { findUnique: m.ownerTurn },
  },
}));
vi.mock("@/lib/image-studio/access", () => ({
  requireProjectAccess: m.access,
}));
vi.mock("@/services/newsletter.service", () => ({
  getNewsletter: m.newsletter,
}));
vi.mock("@/services/newsletter-draft.service", () => ({
  isNewsletterDraftAvailable: m.available,
}));
vi.mock("@/lib/db/transaction", () => ({
  serializableTransaction: async (
    operation: (tx: unknown) => Promise<unknown>,
  ) =>
    operation({
      $queryRaw: m.query,
      workspace: { findFirst: m.workspace },
      sokoBotTurn: { findFirst: m.turn, findUnique: async () => null },
      sokoBotToolCall: {
        findUnique: m.receipt,
        create: m.reserve,
        count: m.count,
        update: m.receiptUpdate,
      },
      user: { findMany: async () => [] },
      task: { findFirst: async () => null },
      newsletterIssue: {
        findUnique: async () => m.issue.current,
        findUniqueOrThrow: async () => m.issue.current,
        create: m.issueCreate,
        updateMany: m.issueUpdate,
        deleteMany: m.issueDelete,
      },
    }),
}));

import {
  type AuthorizedSokoBotRuntime,
  SokoBotRuntimeService,
} from "./soko-bot-runtime.service";

const BOT_ID = "77777777-7777-4777-8777-777777777777";
const WRITES = [
  "create_newsletter_issue",
  "update_newsletter_issue",
  "delete_newsletter_issue",
] as const;
type Write = (typeof WRITES)[number];
const CONTENT = [
  { type: "heading" as const, level: 1 as const, text: "Launch" },
  { type: "text" as const, text: "We shipped." },
  { type: "button" as const, label: "Read more", url: "https://example.com" },
];
const INPUTS: Record<Write, Record<string, unknown>> = {
  create_newsletter_issue: {
    projectId: NEWSLETTER_PROJECT_ID,
    subject: "Launch week",
    template: "BUTTONS",
    content: CONTENT,
  },
  update_newsletter_issue: {
    projectId: NEWSLETTER_PROJECT_ID,
    issueId: NEWSLETTER_ISSUE_ID,
    revision: 3,
    subject: "Launch week, revised",
  },
  delete_newsletter_issue: {
    projectId: NEWSLETTER_PROJECT_ID,
    issueId: NEWSLETTER_ISSUE_ID,
    revision: 3,
  },
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
    capabilities: [...WRITES],
    issuedAt: 0,
    expiresAt: Date.now() + 60_000,
  },
  reader: { userId: "user", audience: "OWNER", sharedScope: null },
  classificationConfidence: 1,
  toolCallLimit: 10,
  askedByKind: "OWNER",
};

function issue(overrides: Partial<NewsletterIssue> = {}): NewsletterIssue {
  return { ...NEWSLETTER_ISSUE, revision: 3, ...overrides };
}

function execute(
  capability: Write,
  input: unknown = INPUTS[capability],
  authorized = AUTHORIZED,
) {
  const runtime = new SokoBotRuntimeService();
  vi.spyOn(runtime, "authorize").mockResolvedValue(authorized);
  return runtime.executeTool({
    sessionId: "session",
    turnId: "turn",
    toolCallId: `call-${capability}`,
    capability,
    input,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  m.issue.current = issue();
  m.access.mockResolvedValue({
    projectId: NEWSLETTER_PROJECT_ID,
    workspaceId: NEWSLETTER_WORKSPACE_ID,
    userId: "user",
    organizationId: null,
  });
  m.available.mockResolvedValue(true);
  m.newsletter.mockResolvedValue(NEWSLETTER);
  m.issueCreate.mockImplementation(async ({ data }) => ({
    ...issue({ revision: 0 }),
    ...data,
  }));
  m.issueUpdate.mockImplementation(async ({ where, data }) => {
    const current = m.issue.current;
    if (!current || current.revision !== where.revision) return { count: 0 };
    m.issue.current = {
      ...current,
      ...data,
      revision: current.revision + data.revision.increment,
    };
    return { count: 1 };
  });
  m.issueDelete.mockResolvedValue({ count: 1 });
  // The owner typed this turn in their own chat.
  m.ownerTurn.mockResolvedValue({
    source: "CHAT",
    parentTurnId: null,
    askedByUserId: null,
    chainDepth: 0,
    chatMentionId: "mention",
  });
  m.receipt.mockResolvedValue(null);
  m.receiptUpdate.mockResolvedValue({});
  m.finish.mockResolvedValue({ count: 1 });
  m.count.mockResolvedValue(0);
  m.turn.mockResolvedValue({
    id: "turn",
    sokoBot: { id: BOT_ID, userId: "user", projectId: null, workspaceId: null },
  });
  m.workspace.mockResolvedValue({
    id: NEWSLETTER_WORKSPACE_ID,
    organizationId: null,
  });
});

describe("Soko Bot newsletter issue writes", () => {
  it.each(WRITES)("%s is an action with a label", (capability) => {
    expect(ACTION_CAPABILITIES.has(capability)).toBe(true);
    expect(EXTERNAL_EFFECT_CAPABILITIES.has(capability)).toBe(false);
    expect(ACTION_LABELS[capability]).toBeTruthy();
  });

  it("creates a bot-authored DRAFT from exact content and records the receipt", async () => {
    const result = await execute("create_newsletter_issue");
    expect(result).toMatchObject({
      projectId: NEWSLETTER_PROJECT_ID,
      subject: "Launch week",
      status: "DRAFT",
      url: `/projects/${NEWSLETTER_PROJECT_ID}/newsletter/issues/${NEWSLETTER_ISSUE_ID}`,
    });
    expect(m.issueCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: NEWSLETTER_PROJECT_ID,
        workspaceId: NEWSLETTER_WORKSPACE_ID,
        newsletterId: NEWSLETTER.id,
        subject: "Launch week",
        template: "BUTTONS",
        content: CONTENT,
        creatorSokoBotId: BOT_ID,
      }),
    });
    expect(m.issueCreate.mock.calls[0]?.[0].data).not.toHaveProperty("status");
    expect(m.receiptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorBotId: BOT_ID,
          targetId: NEWSLETTER_ISSUE_ID,
          disposition: "APPLIED",
        }),
      }),
    );
  });

  it("returns an approved issue to DRAFT and clears its approval on edit", async () => {
    m.issue.current = issue({
      status: "NEEDS_APPROVAL",
      approvedAt: new Date(),
      approvedByUserId: "approver",
    });
    const result = await execute("update_newsletter_issue");
    expect(result).toMatchObject({
      subject: "Launch week, revised",
      status: "DRAFT",
      revision: 4,
    });
    expect(m.issue.current).toMatchObject({
      status: "DRAFT",
      approvedAt: null,
      approvedByUserId: null,
    });
    expect(m.receiptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ targetId: NEWSLETTER_ISSUE_ID }),
      }),
    );
  });

  it("turns a stale revision into a clear reload-and-retry error", async () => {
    m.issue.current = issue({ revision: 5 });
    await expect(execute("update_newsletter_issue")).rejects.toThrow(
      /changed.*get_newsletter_issue.*human edits/,
    );
    expect(m.issueUpdate).not.toHaveBeenCalled();
    expect(m.receiptUpdate).not.toHaveBeenCalled();
  });

  it("refuses to edit a scheduled issue", async () => {
    m.issue.current = issue({ status: "SCHEDULED" });
    await expect(execute("update_newsletter_issue")).rejects.toThrow(
      "Only draft or needs-approval issues can be edited",
    );
    expect(m.issueUpdate).not.toHaveBeenCalled();
  });

  it("deletes a draft on the owner's word and links the issue list", async () => {
    const result = await execute("delete_newsletter_issue");
    expect(result).toEqual({
      id: NEWSLETTER_ISSUE_ID,
      projectId: NEWSLETTER_PROJECT_ID,
      revision: 3,
      deleted: true,
    });
    expect(m.issueDelete).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: NEWSLETTER_ISSUE_ID, revision: 3 }),
    });
    expect(m.receiptUpdate).toHaveBeenCalled();
  });

  it("refuses a delete the owner did not ask for", async () => {
    m.ownerTurn.mockResolvedValue({
      source: "SCHEDULE",
      parentTurnId: null,
      askedByUserId: null,
      chainDepth: 0,
      chatMentionId: null,
    });
    await expect(execute("delete_newsletter_issue")).rejects.toThrow(
      "only deleted when the owner asks",
    );
    expect(m.issueDelete).not.toHaveBeenCalled();
  });

  it.each(["SCHEDULED", "SENDING", "SENT", "NEEDS_APPROVAL"] as const)(
    "refuses to delete a %s issue",
    async (status) => {
      m.issue.current = issue({ status });
      await expect(execute("delete_newsletter_issue")).rejects.toThrow(
        "Only draft or canceled issues can be deleted",
      );
      expect(m.issueDelete).not.toHaveBeenCalled();
    },
  );

  it("refuses to delete an issue changed since the bot read it", async () => {
    m.issue.current = issue({ revision: 4 });
    await expect(execute("delete_newsletter_issue")).rejects.toThrow(
      /get_newsletter_issue/,
    );
    expect(m.issueDelete).not.toHaveBeenCalled();
  });

  it.each(WRITES)(
    "%s runs only where the newsletter is enabled",
    async (capability) => {
      m.available.mockResolvedValue(false);
      await expect(execute(capability)).rejects.toThrow(
        "Newsletter is not enabled",
      );
      expect(m.issueCreate).not.toHaveBeenCalled();
      expect(m.issueUpdate).not.toHaveBeenCalled();
      expect(m.issueDelete).not.toHaveBeenCalled();
    },
  );

  it.each(WRITES)(
    "%s stays in a project bot's own Project",
    async (capability) => {
      await expect(
        execute(capability, INPUTS[capability], {
          ...AUTHORIZED,
          reader: {
            userId: "user",
            audience: "TEAMMATE",
            sharedScope: {
              sokoBotId: BOT_ID,
              workspaceId: NEWSLETTER_WORKSPACE_ID,
              projectId: "another-project",
            },
          },
        }),
      ).rejects.toThrow("own Project");
      expect(m.access).not.toHaveBeenCalled();
    },
  );

  it.each(
    WRITES.flatMap((capability) =>
      ["approve", "autoApprove", "status", "scheduledAt", "send"].map(
        (field) => [capability, field] as const,
      ),
    ),
  )("%s rejects a %s field", async (capability, field) => {
    expect(
      SOKO_BOT_TOOL_INPUT_SCHEMAS[capability].safeParse({
        ...INPUTS[capability],
        [field]: true,
      }).success,
    ).toBe(false);
    await expect(
      execute(capability, { ...INPUTS[capability], [field]: true }),
    ).rejects.toThrow();
    expect(m.issueCreate).not.toHaveBeenCalled();
    expect(m.issueUpdate).not.toHaveBeenCalled();
    expect(m.issueDelete).not.toHaveBeenCalled();
  });
});
