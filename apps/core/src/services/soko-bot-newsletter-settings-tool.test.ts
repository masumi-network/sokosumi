import type { Newsletter } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACTION_CAPABILITIES,
  EXTERNAL_EFFECT_CAPABILITIES,
} from "@/lib/soko-bot/action-receipts";
import { ACTION_LABELS } from "@/lib/soko-bot/action-response";
import {
  NEWSLETTER,
  NEWSLETTER_PROJECT_ID,
  NEWSLETTER_WORKSPACE_ID,
} from "@/test/newsletter";

// putNewsletter runs for real against this in-memory newsletter, so the save
// under test is the one the settings page gets.
const m = vi.hoisted(() => ({
  access: vi.fn(),
  available: vi.fn(),
  newsletter: { current: null as Newsletter | null },
  upsert: vi.fn(),
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
vi.mock("@/services/project-social-connections.service", () => ({
  requireScopedProject: async () => {},
}));
vi.mock("@/services/newsletter.service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getNewsletter: async () => m.newsletter.current,
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
      newsletter: { upsert: m.upsert },
    }),
}));

import {
  type AuthorizedSokoBotRuntime,
  SokoBotRuntimeService,
} from "./soko-bot-runtime.service";

const BOT_ID = "77777777-7777-4777-8777-777777777777";
const SAVED_AT = new Date("2026-10-26T12:00:00Z");
const CURRENT: Newsletter = {
  ...NEWSLETTER,
  brand: {
    logoUrl: "https://example.com/logo.png",
    primaryColor: "#000000",
    footerText: "Old footer",
  },
  welcomeSubject: "Welcome",
  welcomeBody: "Thanks for joining",
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
    capabilities: ["update_newsletter_settings"],
    issuedAt: 0,
    expiresAt: Date.now() + 60_000,
  },
  reader: { userId: "user", audience: "OWNER", sharedScope: null },
  classificationConfidence: 1,
  toolCallLimit: 10,
  askedByKind: "OWNER",
};

function execute(change: Record<string, unknown>, authorized = AUTHORIZED) {
  const runtime = new SokoBotRuntimeService();
  vi.spyOn(runtime, "authorize").mockResolvedValue(authorized);
  return runtime.executeTool({
    sessionId: "session",
    turnId: "turn",
    toolCallId: "call-settings",
    capability: "update_newsletter_settings",
    input: { projectId: NEWSLETTER_PROJECT_ID, ...change },
  });
}

function scheduledTurn() {
  m.ownerTurn.mockResolvedValue({
    source: "SCHEDULE",
    parentTurnId: null,
    askedByUserId: null,
    chainDepth: 0,
    chatMentionId: null,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  m.newsletter.current = CURRENT;
  m.access.mockResolvedValue({
    projectId: NEWSLETTER_PROJECT_ID,
    workspaceId: NEWSLETTER_WORKSPACE_ID,
    userId: "user",
    organizationId: null,
  });
  m.available.mockResolvedValue(true);
  m.upsert.mockImplementation(async ({ update }) => ({
    ...m.newsletter.current,
    ...update,
    updatedAt: SAVED_AT,
  }));
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

describe("Soko Bot newsletter settings", () => {
  it("is an action with a label", () => {
    expect(ACTION_CAPABILITIES.has("update_newsletter_settings")).toBe(true);
    expect(EXTERNAL_EFFECT_CAPABILITIES.has("update_newsletter_settings")).toBe(
      false,
    );
    expect(ACTION_LABELS.update_newsletter_settings).toBeTruthy();
  });

  it("merges a brand change and keeps every other setting", async () => {
    // A scheduled turn: brand changes do not need the owner's word.
    scheduledTurn();
    const result = await execute({
      brand: { primaryColor: "#1a2b3c", logoUrl: null },
    });
    expect(m.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: NEWSLETTER_PROJECT_ID,
          workspaceId: NEWSLETTER_WORKSPACE_ID,
        },
        update: {
          name: CURRENT.name,
          senderName: CURRENT.senderName,
          replyTo: CURRENT.replyTo,
          welcomeEmailEnabled: false,
          welcomeSubject: "Welcome",
          welcomeBody: "Thanks for joining",
          brand: { primaryColor: "#1a2b3c", footerText: "Old footer" },
        },
      }),
    );
    expect(result).toEqual({
      id: NEWSLETTER.id,
      projectId: NEWSLETTER_PROJECT_ID,
      updated: ["brand.logoUrl", "brand.primaryColor"],
      updatedAt: SAVED_AT.toISOString(),
      url: `/projects/${NEWSLETTER_PROJECT_ID}/newsletter`,
    });
    expect(m.receiptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorBotId: BOT_ID,
          targetId: NEWSLETTER.id,
          disposition: "APPLIED",
        }),
      }),
    );
  });

  it("renames without the owner's word", async () => {
    scheduledTurn();
    await execute({ name: "Monthly News" });
    expect(m.upsert.mock.calls[0]?.[0].update).toMatchObject({
      name: "Monthly News",
      senderName: CURRENT.senderName,
      brand: CURRENT.brand,
    });
  });

  it.each([
    { senderName: "Grace" },
    { replyTo: "grace@example.com" },
    { welcomeEmailEnabled: true },
    { welcomeSubject: "Hi" },
    { welcomeBody: null },
  ])("refuses %j when the owner did not ask this turn", async (change) => {
    scheduledTurn();
    await expect(execute({ name: "Weekly", ...change })).rejects.toThrow(
      "only when the owner asks in chat",
    );
    expect(m.upsert).not.toHaveBeenCalled();
    expect(m.receiptUpdate).not.toHaveBeenCalled();
  });

  it("changes sender, reply-to and the welcome email on the owner's word", async () => {
    await execute({
      senderName: "Grace",
      replyTo: "Grace@Example.com",
      welcomeEmailEnabled: true,
    });
    expect(m.upsert.mock.calls[0]?.[0].update).toMatchObject({
      senderName: "Grace",
      replyTo: "grace@example.com",
      welcomeEmailEnabled: true,
      welcomeSubject: "Welcome",
      brand: CURRENT.brand,
    });
  });

  it.each([
    { brand: { primaryColor: "red" } },
    { brand: { logoUrl: "not a url" } },
    { brand: { logoUrl: "http://example.com/logo.png" } },
  ])("rejects %j before saving", async (change) => {
    await expect(execute(change)).rejects.toThrow();
    expect(m.upsert).not.toHaveBeenCalled();
  });

  it("runs only where the newsletter is enabled", async () => {
    m.available.mockResolvedValue(false);
    await expect(execute({ name: "Weekly" })).rejects.toThrow(
      "Newsletter is not enabled",
    );
    expect(m.upsert).not.toHaveBeenCalled();
  });

  it("stays in a project bot's own Project", async () => {
    await expect(
      execute(
        { name: "Weekly" },
        {
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
        },
      ),
    ).rejects.toThrow("own Project");
    expect(m.access).not.toHaveBeenCalled();
    expect(m.upsert).not.toHaveBeenCalled();
  });
});
