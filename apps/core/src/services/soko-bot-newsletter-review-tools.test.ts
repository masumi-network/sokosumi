import type { NewsletterIssue } from "@sokosumi/database";
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

// The issue service runs for real against this in-memory issue; the email
// renderer and the Task domain are mocked, so nothing renders or mails.
const m = vi.hoisted(() => ({
  access: vi.fn(),
  available: vi.fn(),
  newsletter: vi.fn(),
  issue: { current: null as NewsletterIssue | null },
  issueUpdate: vi.fn(),
  issueLink: vi.fn(),
  render: vi.fn(),
  createTask: vi.fn(),
  bot: vi.fn(),
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
vi.mock("@sokosumi/email", () => ({ renderNewsletterEmail: m.render }));
vi.mock("@/services/task-domain.service", () => ({
  createTaskForActor: m.createTask,
  archiveTaskRecord: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotToolCall: { findUnique: m.receipt, updateMany: m.finish },
    newsletterIssue: { findUnique: async () => m.issue.current },
    user: { findMany: async () => [] },
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
      sokoBot: { findUnique: m.bot },
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
        updateMany: m.issueUpdate,
        update: m.issueLink,
      },
    }),
}));

import {
  type AuthorizedSokoBotRuntime,
  SokoBotRuntimeService,
} from "./soko-bot-runtime.service";

const BOT_ID = "77777777-7777-4777-8777-777777777777";
const TASK_ID = "88888888-8888-4888-8888-888888888888";
const ISSUE_URL = `/projects/${NEWSLETTER_PROJECT_ID}/newsletter/issues/${NEWSLETTER_ISSUE_ID}`;
const TOOLS = ["preview_newsletter_issue", "submit_newsletter_issue"] as const;
type Tool = (typeof TOOLS)[number];
const INPUTS: Record<Tool, Record<string, unknown>> = {
  preview_newsletter_issue: {
    projectId: NEWSLETTER_PROJECT_ID,
    issueId: NEWSLETTER_ISSUE_ID,
  },
  submit_newsletter_issue: {
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
    capabilities: [...TOOLS],
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
  capability: Tool,
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
  m.newsletter.mockResolvedValue({
    ...NEWSLETTER,
    brand: { accentColor: "#123456" },
  });
  m.render.mockResolvedValue({
    subject: "Hello readers",
    html: "<html>rendered</html>",
    text: "HELLO READERS\n\nThis week's news",
  });
  m.issueUpdate.mockImplementation(async ({ where, data }) => {
    const current = m.issue.current;
    if (
      !current ||
      current.revision !== where.revision ||
      current.status !== where.status
    )
      return { count: 0 };
    m.issue.current = {
      ...current,
      ...data,
      revision: current.revision + data.revision.increment,
    };
    return { count: 1 };
  });
  m.issueLink.mockResolvedValue({});
  m.createTask.mockResolvedValue({ id: TASK_ID });
  m.bot.mockResolvedValue({
    userId: "user",
    projectId: null,
    workspace: { id: NEWSLETTER_WORKSPACE_ID, organizationId: null },
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

describe("Soko Bot newsletter preview", () => {
  it("is a read, with no receipt", () => {
    expect(ACTION_CAPABILITIES.has("preview_newsletter_issue")).toBe(false);
  });

  it("renders a saved issue with the newsletter brand and sends nothing", async () => {
    const result = await execute("preview_newsletter_issue");
    expect(m.render).toHaveBeenCalledWith({
      newsletter: { name: NEWSLETTER.name, brand: { accentColor: "#123456" } },
      issue: {
        subject: "Hello readers",
        previewText: null,
        template: "TEXT",
        content: [{ type: "text", text: "This week's news" }],
      },
      unsubscribeUrl: "#",
    });
    expect(result).toEqual({
      issueId: NEWSLETTER_ISSUE_ID,
      status: "DRAFT",
      revision: 3,
      subject: "Hello readers",
      previewText: null,
      text: "HELLO READERS\n\nThis week's news",
      textTruncated: false,
      htmlBytes: 21,
      warnings: ["No preview text: inboxes show the subject as the snippet"],
      url: ISSUE_URL,
    });
    expect(m.issueUpdate).not.toHaveBeenCalled();
    expect(m.receiptUpdate).not.toHaveBeenCalled();
  });

  it("previews unsaved content and warns about what will not render well", async () => {
    m.render.mockResolvedValue({
      subject: "Draft",
      html: "x".repeat(110 * 1024),
      text: "y".repeat(9_000),
    });
    const result = await execute("preview_newsletter_issue", {
      projectId: NEWSLETTER_PROJECT_ID,
      subject: "Draft",
      previewText: "Inside: news",
      template: "IMAGES",
      content: [
        { type: "heading", level: 1, text: " " },
        { type: "image", url: "https://example.com/a.png", alt: "" },
        { type: "text", text: "See [our site](http://example.com)" },
      ],
    });
    expect(result).toMatchObject({
      subject: "Draft",
      previewText: "Inside: news",
      textTruncated: true,
      url: `/projects/${NEWSLETTER_PROJECT_ID}/newsletter/issues`,
      warnings: [
        "Block 1 (heading) is empty",
        "Block 2 (image) has no alt text",
        "Block 3 (text) has a link that is not https and will show as text",
        "The email is 110 KB; Gmail clips messages over 102 KB",
      ],
    });
    expect((result as { text: string }).text).toHaveLength(8_000);
    expect(result).not.toHaveProperty("issueId");
  });

  it("refuses a Project outside the member's access", async () => {
    m.access.mockRejectedValue(new Error("Project not found"));
    await expect(execute("preview_newsletter_issue")).rejects.toThrow(
      "Project not found",
    );
    expect(m.render).not.toHaveBeenCalled();
  });
});

describe("Soko Bot newsletter submit for approval", () => {
  it("is an action with its label", () => {
    expect(ACTION_CAPABILITIES.has("submit_newsletter_issue")).toBe(true);
    expect(EXTERNAL_EFFECT_CAPABILITIES.has("submit_newsletter_issue")).toBe(
      false,
    );
    expect(ACTION_LABELS.submit_newsletter_issue).toBe(
      "Submitted newsletter issue for approval",
    );
  });

  it("moves a DRAFT to NEEDS_APPROVAL and opens a human approval Task as the bot", async () => {
    const result = await execute("submit_newsletter_issue");
    expect(result).toEqual({
      id: NEWSLETTER_ISSUE_ID,
      projectId: NEWSLETTER_PROJECT_ID,
      subject: "Hello readers",
      status: "NEEDS_APPROVAL",
      revision: 4,
      url: ISSUE_URL,
    });
    expect(m.issue.current).toMatchObject({
      status: "NEEDS_APPROVAL",
      approvedAt: null,
      approvedByUserId: null,
    });
    // The same Task a bot gets when it submits over REST with its own key.
    expect(m.createTask).toHaveBeenCalledWith(
      {
        actor: { kind: "soko_bot", sokoBotId: BOT_ID },
        ownerId: "user",
        organizationId: null,
        projectId: NEWSLETTER_PROJECT_ID,
        workspaceId: NEWSLETTER_WORKSPACE_ID,
        name: "Approve newsletter: Hello readers",
        assigneeUserId: null,
        status: "READY",
      },
      expect.anything(),
    );
    expect(m.issueLink).toHaveBeenCalledWith({
      where: { id: NEWSLETTER_ISSUE_ID },
      data: { taskId: TASK_ID },
    });
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

  it.each(["NEEDS_APPROVAL", "SCHEDULED", "SENT", "CANCELED"] as const)(
    "refuses to submit a %s issue and says why",
    async (status) => {
      m.issue.current = issue({ status });
      await expect(execute("submit_newsletter_issue")).rejects.toThrow(
        `Only draft issues can be submitted for approval; this one is ${status}`,
      );
      expect(m.issueUpdate).not.toHaveBeenCalled();
      expect(m.createTask).not.toHaveBeenCalled();
      expect(m.receiptUpdate).not.toHaveBeenCalled();
    },
  );

  it("turns a stale revision into a clear reload-and-retry error", async () => {
    m.issue.current = issue({ revision: 5 });
    await expect(execute("submit_newsletter_issue")).rejects.toThrow(
      /changed.*get_newsletter_issue.*current revision/,
    );
    expect(m.createTask).not.toHaveBeenCalled();
    expect(m.receiptUpdate).not.toHaveBeenCalled();
  });

  it.each(["approve", "autoApprove", "skipApproval", "scheduledAt", "sendNow"])(
    "rejects a %s field",
    async (field) => {
      await expect(
        execute("submit_newsletter_issue", {
          ...INPUTS.submit_newsletter_issue,
          [field]: true,
        }),
      ).rejects.toThrow();
      expect(m.issueUpdate).not.toHaveBeenCalled();
    },
  );
});

describe("Soko Bot newsletter review scope", () => {
  it.each(TOOLS)(
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
      expect(m.render).not.toHaveBeenCalled();
      expect(m.issueUpdate).not.toHaveBeenCalled();
    },
  );

  it.each(TOOLS)(
    "%s runs only where the newsletter is enabled",
    async (capability) => {
      m.available.mockResolvedValue(false);
      await expect(execute(capability)).rejects.toThrow(
        "Newsletter is not enabled",
      );
      expect(m.render).not.toHaveBeenCalled();
      expect(m.issueUpdate).not.toHaveBeenCalled();
    },
  );
});
