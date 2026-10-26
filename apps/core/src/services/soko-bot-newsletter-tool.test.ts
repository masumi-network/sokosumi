import { SOKO_BOT_TOOL_INPUT_SCHEMAS } from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACTION_CAPABILITIES,
  actionInputHash,
  EXTERNAL_EFFECT_CAPABILITIES,
} from "@/lib/soko-bot/action-receipts";
import {
  NEWSLETTER_ISSUE,
  NEWSLETTER_PROJECT_ID,
  NEWSLETTER_WORKSPACE_ID,
} from "@/test/newsletter";

const m = vi.hoisted(() => ({
  enabled: true,
  access: vi.fn(),
  newsletter: vi.fn(),
  generate: vi.fn(),
  available: vi.fn(),
  create: vi.fn(),
  approve: vi.fn(),
  schedule: vi.fn(),
  send: vi.fn(),
  receipt: vi.fn(),
  receiptUpdate: vi.fn(),
  finish: vi.fn(),
  turn: vi.fn(),
  turnUnique: vi.fn(),
  workspace: vi.fn(),
  query: vi.fn(),
  reserve: vi.fn(),
  count: vi.fn(),
}));
vi.mock("@/config/env", () => ({
  getEnv: () => ({ NEWSLETTER_ENABLED: m.enabled }),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: { sokoBotToolCall: { findUnique: m.receipt, updateMany: m.finish } },
}));
vi.mock("@/lib/image-studio/access", () => ({
  requireProjectAccess: m.access,
}));
vi.mock("@/services/newsletter.service", () => ({
  getNewsletter: m.newsletter,
}));
vi.mock("@/services/newsletter-draft.service", () => ({
  generateNewsletterDraft: m.generate,
  isNewsletterDraftAvailable: m.available,
}));
vi.mock("@/services/newsletter-issues.service", () => ({
  createNewsletterIssue: m.create,
  approveNewsletterIssue: m.approve,
  scheduleNewsletterIssue: m.schedule,
  sendNewsletterIssueNow: m.send,
}));
vi.mock("@/lib/db/transaction", () => ({
  serializableTransaction: async (
    operation: (tx: unknown) => Promise<unknown>,
  ) =>
    operation({
      $queryRaw: m.query,
      workspace: { findFirst: m.workspace },
      sokoBotTurn: { findFirst: m.turn, findUnique: m.turnUnique },
      sokoBotToolCall: {
        findUnique: m.receipt,
        create: m.reserve,
        count: m.count,
        update: m.receiptUpdate,
      },
    }),
}));

import {
  type AuthorizedSokoBotRuntime,
  SokoBotRuntimeService,
} from "./soko-bot-runtime.service";

const BOT_ID = "77777777-7777-4777-8777-777777777777";
const INPUT = {
  projectId: NEWSLETTER_PROJECT_ID,
  brief: "Draft the launch newsletter",
  useProjectMemory: true,
};
const DRAFT = {
  subject: "Launch",
  template: "TEXT" as const,
  content: [{ type: "text" as const, text: "Launch news" }],
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
    capabilities: ["newsletter_draft_issue"],
    issuedAt: 0,
    expiresAt: Date.now() + 60_000,
  },
  reader: { userId: "user", audience: "OWNER", sharedScope: null },
  classificationConfidence: 1,
  toolCallLimit: 10,
  askedByKind: "OWNER",
};

function service(authorized = AUTHORIZED) {
  const runtime = new SokoBotRuntimeService();
  vi.spyOn(runtime, "authorize").mockResolvedValue(authorized);
  return runtime;
}
function execute(runtime = service(), input: unknown = INPUT) {
  return runtime.executeTool({
    sessionId: "session",
    turnId: "turn",
    toolCallId: "draft",
    capability: "newsletter_draft_issue",
    input,
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  m.enabled = true;
  m.access.mockResolvedValue({
    projectId: NEWSLETTER_PROJECT_ID,
    workspaceId: NEWSLETTER_WORKSPACE_ID,
    userId: "user",
    organizationId: null,
  });
  m.newsletter.mockResolvedValue({ id: NEWSLETTER_ISSUE.newsletterId });
  m.generate.mockResolvedValue(DRAFT);
  m.available.mockResolvedValue(true);
  m.create.mockResolvedValue(NEWSLETTER_ISSUE);
  m.receipt.mockResolvedValue(null);
  m.receiptUpdate.mockResolvedValue({ capability: "newsletter_draft_issue" });
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

describe("Soko Bot newsletter_draft_issue", () => {
  it("creates only a draft and records bot authorship and the receipt atomically", async () => {
    const result = await execute();
    expect(result).toMatchObject({
      status: "DRAFT",
      id: NEWSLETTER_ISSUE.id,
      projectId: NEWSLETTER_PROJECT_ID,
    });
    expect(ACTION_CAPABILITIES.has("newsletter_draft_issue")).toBe(true);
    expect(EXTERNAL_EFFECT_CAPABILITIES.has("newsletter_draft_issue")).toBe(
      false,
    );
    expect(m.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: NEWSLETTER_PROJECT_ID,
        workspaceId: NEWSLETTER_WORKSPACE_ID,
      }),
      expect.objectContaining({ brief: INPUT.brief, useProjectMemory: true }),
    );
    expect(m.create).toHaveBeenCalledWith(
      {
        projectId: NEWSLETTER_PROJECT_ID,
        workspaceId: NEWSLETTER_WORKSPACE_ID,
      },
      DRAFT,
      {
        client: expect.objectContaining({
          sokoBotToolCall: expect.any(Object),
        }),
        creatorSokoBotId: BOT_ID,
      },
    );
    expect(m.receiptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorBotId: BOT_ID,
          targetId: NEWSLETTER_ISSUE.id,
          verification: "LOCAL_TRANSACTION",
          disposition: "APPLIED",
        }),
      }),
    );
    expect(m.approve).not.toHaveBeenCalled();
    expect(m.schedule).not.toHaveBeenCalled();
    expect(m.send).not.toHaveBeenCalled();
  });

  it("keeps the receipt's review target for drafts larger than the tool result limit", async () => {
    m.create.mockResolvedValue({
      ...NEWSLETTER_ISSUE,
      content: [{ type: "text", text: "x".repeat(20_000) }],
    });
    const result = await execute();
    expect(result).toEqual({
      id: NEWSLETTER_ISSUE.id,
      projectId: NEWSLETTER_PROJECT_ID,
      subject: NEWSLETTER_ISSUE.subject,
      status: "DRAFT",
      revision: NEWSLETTER_ISSUE.revision,
    });
    expect(m.receiptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ result }) }),
    );
  });

  it.each([
    "approve",
    "schedule",
    "send",
    "status",
    "approvedAt",
    "scheduledAt",
    "workspaceId",
  ])("rejects model attempts to set %s", async (field) => {
    await expect(
      execute(service(), { ...INPUT, [field]: true }),
    ).rejects.toThrow();
    expect(m.generate).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
    expect(m.approve).not.toHaveBeenCalled();
    expect(m.schedule).not.toHaveBeenCalled();
    expect(m.send).not.toHaveBeenCalled();
  });

  it("requires the feature and a configured newsletter even when replaying", async () => {
    m.enabled = false;
    await expect(execute()).rejects.toThrow("Newsletter is not enabled");
    m.enabled = true;
    m.newsletter.mockRejectedValue(new Error("Newsletter not found"));
    await expect(execute()).rejects.toThrow("Newsletter not found");
    expect(m.generate).not.toHaveBeenCalled();
  });

  it("refuses a project bot's attempt to draft in another project", async () => {
    const runtime = service({
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
    });
    await expect(execute(runtime)).rejects.toThrow("own Project");
    expect(m.access).not.toHaveBeenCalled();
    expect(m.generate).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "refuses a non-beta workspace before generation or completed-receipt replay (replay=%s)",
    async (replay) => {
      m.available.mockResolvedValue(false);
      if (replay) {
        m.receipt.mockResolvedValue({
          capability: "newsletter_draft_issue",
          inputHash: actionInputHash(INPUT),
          status: "COMPLETED",
          result: NEWSLETTER_ISSUE,
          turnId: "turn",
          toolCallId: "draft",
        });
      }
      await expect(execute()).rejects.toThrow("Newsletter is not enabled");
      expect(m.available).toHaveBeenCalledWith({
        projectId: NEWSLETTER_PROJECT_ID,
        workspaceId: NEWSLETTER_WORKSPACE_ID,
      });
      expect(m.generate).not.toHaveBeenCalled();
      expect(m.create).not.toHaveBeenCalled();
      expect(m.receipt).not.toHaveBeenCalled();
    },
  );

  it("replays a completed receipt without generating or creating a second issue", async () => {
    m.receipt.mockResolvedValue({
      capability: "newsletter_draft_issue",
      inputHash: actionInputHash(INPUT),
      status: "COMPLETED",
      result: NEWSLETTER_ISSUE,
      turnId: "turn",
      toolCallId: "draft",
    });
    expect(await execute()).toEqual(NEWSLETTER_ISSUE);
    expect(m.generate).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
  });

  it("does not persist a draft if cancellation revokes the turn during generation", async () => {
    m.turn.mockResolvedValue(null);
    await expect(execute()).rejects.toThrow("no longer writable");
    expect(m.generate).toHaveBeenCalledTimes(1);
    expect(m.create).not.toHaveBeenCalled();
  });

  it("has a strict draft-only tool schema", () => {
    expect(
      SOKO_BOT_TOOL_INPUT_SCHEMAS.newsletter_draft_issue.parse(INPUT),
    ).toMatchObject({
      template: "TEXT",
      imageIds: [],
      useRecentSocialPosts: false,
    });
  });
});
