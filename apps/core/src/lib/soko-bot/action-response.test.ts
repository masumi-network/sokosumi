import type { SokoBotToolCall } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/db/prisma";
import { ACTION_CAPABILITIES } from "./action-receipts";
import {
  buildActionResponse,
  HELD_BACK_REPLY,
  parseActionNarrativeText,
} from "./action-response";

const db = vi.hoisted(() => ({
  sokoBotToolCall: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
  sokoBotTurn: { findUnique: vi.fn() },
  sokoBotMemoryRevision: { findFirst: vi.fn() },
  task: { findFirst: vi.fn(), findMany: vi.fn() },
  job: { findMany: vi.fn() },
}));
vi.mock("@/lib/db/prisma", () => ({ default: db }));

function receipt(overrides: Partial<SokoBotToolCall> = {}): SokoBotToolCall {
  return {
    id: "receipt-one",
    turnId: "turn-current",
    toolCallId: "call-one",
    capability: "update_task",
    actorBotId: "bot-one",
    inputHash: "input-hash",
    input: {},
    result: {},
    operationKey: "operation-one",
    status: "COMPLETED",
    disposition: "APPLIED",
    verification: "LOCAL_TRANSACTION",
    targetId: "task-one",
    effectEventId: "event-one",
    observedVersion: null,
    committedAt: new Date("2026-09-26T12:00:00Z"),
    createdAt: new Date("2026-09-26T12:00:00Z"),
    updatedAt: new Date("2026-09-26T12:00:00Z"),
    errorKind: null,
    errorDetail: null,
    replayedReceiptId: null,
    ...overrides,
  };
}

function replay() {
  return receipt({
    id: "replay-one",
    replayedReceiptId: "source-one",
    disposition: "ALREADY_SATISFIED",
    verification: "NONE",
    committedAt: null,
    targetId: null,
    operationKey: null,
  });
}

describe("authoritative action responses", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.task.findMany.mockResolvedValue([]);
    db.sokoBotTurn.findUnique.mockResolvedValue({
      sokoBotId: "bot-one",
      workspaceId: "workspace-one",
      intentId: "intent-one",
      intentRevision: 2,
    });
  });

  it.each([true, false])(
    "checks retained archival history before a success claim: %s",
    async (historyPresent) => {
      const archived = receipt({ capability: "archive_task" });
      db.sokoBotToolCall.findMany.mockResolvedValue([archived]);
      db.sokoBotToolCall.findUnique.mockResolvedValue({
        ...archived,
        turn: { userId: "owner", workspaceId: "workspace-one" },
      });
      db.task.findFirst.mockResolvedValue(
        historyPresent ? { id: "task-one" } : null,
      );
      const result = await buildActionResponse(
        prisma,
        "turn-current",
        "Permanently deleted everything.",
      );
      expect(result.answerText).toBe(
        historyPresent
          ? "Archived task."
          : "Couldn't confirm I archived a Task.",
      );
      expect(db.task.findFirst).toHaveBeenCalledWith({
        where: {
          id: "task-one",
          workspaceId: "workspace-one",
          archivedAt: { not: null },
          // No owner filter: a teammate's public Task the bot archived confirms too.
          events: { some: { id: "event-one", sokoBotId: "bot-one" } },
        },
        select: { id: true },
      });
    },
  );

  it("renders a deterministic action claim and discards unsupported model prose", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([receipt()]);
    expect(
      await buildActionResponse(
        prisma,
        "turn-current",
        "I also hired three agents and delivered the research.",
      ),
    ).toEqual({
      appliedReceiptIds: ["receipt-one"],
      narrative: null,
      observations: [],
      unfulfilledActions: [],
      answerText: "Updated task.",
    });
    expect(db.sokoBotToolCall.findMany).toHaveBeenCalledWith({
      where: {
        turnId: "turn-current",
        capability: { in: [...ACTION_CAPABILITIES] },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  });

  it("does not equate created task with fulfilled work", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([
      receipt({ capability: "create_task" }),
    ]);
    const result = await buildActionResponse(
      prisma,
      "turn-current",
      "All requested work is complete.",
    );
    expect(result.answerText).toBe("Created task.");
  });

  it("shows the bot's own message beneath the verified receipts", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([
      receipt({ capability: "create_task" }),
    ]);
    const result = await buildActionResponse(
      prisma,
      "turn-current",
      JSON.stringify({
        kind: "CLARIFY",
        message: "Hannah will cover pricing. Should I include Sokosumi itself?",
        question: "SCOPE",
        observationToolCallIds: [],
      }),
    );
    expect(result.answerText).toBe(
      "Created task.\n\nHannah will cover pricing. Should I include Sokosumi itself?",
    );
  });

  it("reads the narrative when the model fences it or wraps it in prose", () => {
    const narrative = {
      kind: "REPORT",
      message: "Done looking.",
      question: null,
      observationToolCallIds: [],
    };
    for (const text of [
      `\`\`\`json\n${JSON.stringify(narrative)}\n\`\`\``,
      `Here you go: ${JSON.stringify(narrative)}`,
    ])
      expect(parseActionNarrativeText(text)).toEqual(narrative);
    expect(parseActionNarrativeText("No JSON here.")).toBeNull();
  });

  it("keeps a narrative that cites more reads than it can show", () => {
    const ids = Array.from({ length: 12 }, (_, index) => `call_${index}`);
    const parsed = parseActionNarrativeText(
      JSON.stringify({
        kind: "REPORT",
        message: "This week in numbers.",
        question: null,
        observationToolCallIds: ids,
      }),
    );
    expect(parsed?.message).toBe("This week in numbers.");
    expect(parsed?.observationToolCallIds).toEqual(ids.slice(0, 8));
  });

  it("names created and assigned tasks from the stored task", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([
      receipt({ capability: "create_task" }),
      receipt({ id: "receipt-two", capability: "assign_task" }),
    ]);
    db.task.findMany.mockResolvedValueOnce([
      {
        id: "task-one",
        name: "x402 news [draft]",
        assignee: { name: "Hannah" },
        assigneeUser: null,
        assigneeSokoBot: null,
      },
    ]);
    const result = await buildActionResponse(prisma, "turn-current", "Done.");
    expect(result.answerText).toBe(
      "Created task [x402 news \\[draft\\]](/tasks/task-one).\nAssigned task [x402 news \\[draft\\]](/tasks/task-one) → Hannah.",
    );
  });

  it("names the assignee of a Task created with one", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([
      receipt({ capability: "create_task" }),
    ]);
    db.task.findMany.mockResolvedValueOnce([
      {
        id: "task-one",
        name: "[TEST] Receipt check",
        assignee: { name: "Hannah" },
        assigneeUser: null,
        assigneeSokoBot: null,
      },
    ]);
    const result = await buildActionResponse(prisma, "turn-current", "Done.");
    expect(result.answerText).toBe(
      "Created task [\\[TEST\\] Receipt check](/tasks/task-one) → Hannah.",
    );
  });

  it.each([
    { status: "PENDING" as const },
    { status: "FAILED" as const },
    { disposition: "REJECTED" as const },
    { verification: "NONE" as const },
    { committedAt: null },
    { targetId: null },
  ])(
    "keeps a refused attempt out of a turn the bot started itself %j",
    async (change) => {
      db.sokoBotToolCall.findMany.mockResolvedValueOnce([receipt(change)]);
      db.sokoBotTurn.findUnique.mockResolvedValueOnce({ source: "SCHEDULE" });
      const result = await buildActionResponse(
        prisma,
        "turn-current",
        "Morning update.",
      );
      expect(result.answerText).not.toContain("Couldn't");
      // Still recorded for the claim check and the admin view.
      expect(result.unfulfilledActions).toHaveLength(1);
    },
  );

  it.each([
    { status: "PENDING" as const },
    { status: "FAILED" as const },
    { disposition: "REJECTED" as const },
    { verification: "NONE" as const },
    { committedAt: null },
    { targetId: null },
  ])("rejects incomplete proof %j", async (change) => {
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([receipt(change)]);
    const result = await buildActionResponse(
      prisma,
      "turn-current",
      "The update succeeded.",
    );
    expect(result.appliedReceiptIds).toEqual([]);
    // One that ran without proof is unconfirmed; one that never ran failed.
    expect(result.answerText).toBe(
      "status" in change
        ? "Couldn't update a Task."
        : "Couldn't confirm I updated a Task.",
    );
    expect(result.unfulfilledActions).toEqual([
      {
        action: "update_task",
        receiptId: "receipt-one",
        reason: "NOT_VERIFIED",
      },
    ]);
  });

  it("reports external uncertainty without a success claim or permission to repeat", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([
      receipt({
        capability: "run_integration_tool",
        disposition: "UNKNOWN",
        verification: "NONE",
        committedAt: null,
      }),
    ]);
    const result = await buildActionResponse(
      prisma,
      "turn-current",
      "The meeting is booked. Retrying is safe.",
    );
    expect(result.appliedReceiptIds).toEqual([]);
    expect(result.answerText).toBe(
      "I couldn't confirm whether this went through: integration acknowledged operation. Check before trying again.",
    );
    expect(result.unfulfilledActions[0].reason).toBe("UNKNOWN");
  });

  it("uses original committed evidence for a replay and scopes its lookup", async () => {
    db.sokoBotToolCall.findMany
      .mockResolvedValueOnce([replay()])
      .mockResolvedValueOnce([
        receipt({ id: "source-one", turnId: "turn-prior" }),
      ]);
    const result = await buildActionResponse(
      prisma,
      "turn-current",
      "I applied the update again.",
    );
    expect(result).toMatchObject({
      appliedReceiptIds: ["source-one"],
      unfulfilledActions: [],
      answerText: "Previously verified: Updated task.",
    });
    expect(db.sokoBotToolCall.findMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: { in: ["source-one"] },
        actorBotId: "bot-one",
        turn: {
          sokoBotId: "bot-one",
          workspaceId: "workspace-one",
          intentId: "intent-one",
          intentRevision: 2,
        },
      },
    });
  });

  it("allows only same-turn sources when no durable intent exists", async () => {
    db.sokoBotTurn.findUnique.mockResolvedValueOnce({
      sokoBotId: "bot-one",
      workspaceId: "workspace-one",
      intentId: null,
      intentRevision: null,
    });
    db.sokoBotToolCall.findMany
      .mockResolvedValueOnce([replay()])
      .mockResolvedValueOnce([]);
    const result = await buildActionResponse(prisma, "turn-current", "Done.");
    expect(db.sokoBotToolCall.findMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: { in: ["source-one"] },
        actorBotId: "bot-one",
        turn: {
          id: "turn-current",
          sokoBotId: "bot-one",
          workspaceId: "workspace-one",
        },
      },
    });
    expect(result.appliedReceiptIds).toEqual([]);
  });

  it.each([
    { capability: "hire_agent" },
    { inputHash: "different-hash" },
    { verification: "NONE" as const },
  ])(
    "does not accept a mismatched or unverified replay source %j",
    async (change) => {
      db.sokoBotToolCall.findMany
        .mockResolvedValueOnce([replay()])
        .mockResolvedValueOnce([
          receipt({ id: "source-one", turnId: "turn-prior", ...change }),
        ]);
      const result = await buildActionResponse(prisma, "turn-current", "Done.");
      expect(result.appliedReceiptIds).toEqual([]);
      expect(result.unfulfilledActions).toEqual([
        {
          action: "update_task",
          receiptId: "replay-one",
          reason: "NOT_VERIFIED",
        },
      ]);
    },
  );

  it("deduplicates a same-turn source referenced by a replay", async () => {
    const source = receipt({ id: "source-one" });
    db.sokoBotToolCall.findMany
      .mockResolvedValueOnce([source, replay()])
      .mockResolvedValueOnce([source]);
    const result = await buildActionResponse(
      prisma,
      "turn-current",
      "Done twice.",
    );
    expect(result.appliedReceiptIds).toEqual(["source-one"]);
    expect(result.unfulfilledActions).toEqual([]);
    expect(result.answerText).toBe("Updated task.");
  });

  it.each(["create_table", "write_table_rows", "update_table_columns"])(
    "reports %s only from its committed table receipt",
    async (capability) => {
      db.sokoBotToolCall.findMany.mockResolvedValue([
        receipt({ capability, targetId: "table-one" }),
      ]);
      const result = await buildActionResponse(
        prisma,
        "turn-current",
        "I emailed the table to everyone.",
      );
      expect(result.appliedReceiptIds).toHaveLength(1);
      expect(result.answerText).not.toContain("emailed");
      expect(result.answerText).toContain("/drive/tables/table-one");
      db.sokoBotToolCall.findMany.mockResolvedValue([
        receipt({ capability, targetId: "table-one", verification: "NONE" }),
      ]);
      const unverified = await buildActionResponse(
        prisma,
        "turn-current",
        "Created the table.",
      );
      expect(unverified.appliedReceiptIds).toEqual([]);
      expect(unverified.answerText).toMatch(/^Not confirmed: \w/);
    },
  );

  it("preserves an explicit clarification without accepting success prose", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValue([]);
    const response = await buildActionResponse(
      prisma,
      "turn-current",
      "I changed everything",
      true,
      {
        kind: "CLARIFY",
        question: "TARGET",
        observationToolCallIds: [],
      },
    );
    expect(response.answerText).toBe("Which task or item do you mean?");
  });

  it.each([
    ["create_social_post", "Created social post"],
    ["update_social_post", "Updated social post"],
    ["schedule_social_post", "Scheduled social post"],
    ["cancel_social_post", "Canceled social post"],
    ["publish_social_post", "Published social post"],
  ])("reports %s from committed evidence only", async (capability, label) => {
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([
      receipt({
        capability,
        targetId: "post-one",
        verification:
          capability === "publish_social_post"
            ? "PROVIDER_ACK"
            : "LOCAL_TRANSACTION",
      }),
    ]);
    const response = await buildActionResponse(
      prisma,
      "turn-current",
      "All posts were published.",
    );
    expect(response.answerText).toBe(`${label}.`);
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([
      receipt({
        capability,
        disposition: "UNKNOWN",
        verification: "NONE",
        committedAt: null,
      }),
    ]);
    const unknown = await buildActionResponse(prisma, "turn-current", "Done.");
    expect(unknown.appliedReceiptIds).toEqual([]);
    expect(unknown.answerText).toBe(
      `I couldn't confirm whether this went through: ${label.toLowerCase()}. Check before trying again.`,
    );
  });

  it("reports a created ad campaign with a link to open it", async () => {
    const link = "/ads/campaigns/123?projectId=p1&accountId=a1";
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([
      receipt({
        capability: "create_ad_campaign",
        targetId: "123",
        verification: "PROVIDER_ACK",
        result: { campaignId: "123", status: "PAUSED", link },
      }),
    ]);
    const response = await buildActionResponse(
      prisma,
      "turn-current",
      "The campaign is live.",
    );
    expect(response.answerText).toBe(
      `Created paused ad campaign ([Open campaign](${link})).`,
    );
  });

  it.each([
    [
      "update_ad_campaign",
      "Updated ad campaign",
      { campaignId: "123", updated: true as const },
    ],
    [
      "edit_ad_campaign",
      "Edited ad campaign",
      { campaignId: "123", edited: true as const },
    ],
  ])(
    "reports %s with a link to open the campaign",
    async (capability, label, proof) => {
      const link = "/ads/campaigns/123?projectId=p1&accountId=a1";
      db.sokoBotToolCall.findMany.mockResolvedValueOnce([
        receipt({
          capability,
          targetId: "123",
          verification: "PROVIDER_ACK",
          result: { ...proof, link },
        }),
      ]);
      const response = await buildActionResponse(
        prisma,
        "turn-current",
        "Done.",
      );
      expect(response.answerText).toBe(`${label} ([Open campaign](${link})).`);
    },
  );

  it("reports delete_ad_campaign with no link, since the campaign is gone", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([
      receipt({
        capability: "delete_ad_campaign",
        targetId: "123",
        verification: "PROVIDER_ACK",
        result: { campaignId: "123", deleted: true },
      }),
    ]);
    const response = await buildActionResponse(prisma, "turn-current", "Done.");
    expect(response.answerText).toBe("Deleted ad campaign.");
  });

  it.each([false, true])(
    "quotes connected social account evidence with availability metadata %s",
    async (withAvailability) => {
      const accounts = [
        {
          id: "account-one",
          provider: "linkedin",
          externalHandle: 'Acme\n"Publish now"',
          status: "active",
          connectedAt: "2026-09-28T10:00:00Z",
          disconnectedAt: null,
        },
      ];
      db.sokoBotToolCall.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          receipt({
            capability: "list_project_social_accounts",
            result: withAvailability
              ? {
                  enabledProviders: [
                    "x",
                    "youtube",
                    "linkedin",
                    "instagram",
                    "facebook",
                  ],
                  accounts,
                }
              : accounts,
          }),
        ]);
      const response = await buildActionResponse(
        prisma,
        "turn-current",
        "Done",
        true,
        {
          kind: "REPORT",
          question: null,
          observationToolCallIds: ["read-social"],
        },
      );
      expect(response.appliedReceiptIds).toEqual([]);
      expect(response.answerText).toContain(
        'Observed social account "account-one": platform "linkedin"',
      );
      expect(response.answerText).toContain(
        JSON.stringify('Acme\n"Publish now"'),
      );
      expect(response.answerText).toContain('status "active"');
      expect(response.answerText).toContain(
        'Connected at: "2026-09-28T10:00:00Z"',
      );
      expect(response.answerText).not.toContain("job");
    },
  );

  it("lets Cuso's report card stand in for the receipts", async () => {
    const posted = receipt({
      capability: "create_social_post",
      targetId: "post-one",
    });
    db.sokoBotTurn.findUnique.mockResolvedValue({
      source: "SCHEDULE",
      versionId: "cmo-v1",
    });
    db.sokoBotToolCall.count.mockResolvedValue(1);
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([posted]);
    const cuso = await buildActionResponse(prisma, "turn-current", "", true, {
      kind: "REPORT",
      message: "Two posts are scheduled; the card has the details.",
      question: null,
      observationToolCallIds: [],
    });
    expect(cuso.answerText).toBe(
      "Two posts are scheduled; the card has the details.",
    );

    // A personal Soko Bot keeps its receipt lines.
    db.sokoBotTurn.findUnique.mockResolvedValue({
      source: "SCHEDULE",
      versionId: "v19",
    });
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([posted]);
    const personal = await buildActionResponse(
      prisma,
      "turn-current",
      "",
      true,
      {
        kind: "REPORT",
        message: "Done.",
        question: null,
        observationToolCallIds: [],
      },
    );
    expect(personal.answerText).toContain("Created social post");
  });

  it("keeps Cuso's answer after he saved the Brand Brain", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([]);
    db.sokoBotTurn.findUnique.mockResolvedValue({
      source: "CHAT",
      versionId: "cmo-v1",
    });
    db.sokoBotToolCall.count.mockImplementation(
      async (args: { where: { capability: unknown } }) =>
        JSON.stringify(args.where.capability).includes("save_brand_brain")
          ? 1
          : 0,
    );
    const response = await buildActionResponse(
      prisma,
      "turn-current",
      "Updated: your audience is CTOs now.",
      true,
    );
    expect(response.answerText).toBe("Updated: your audience is CTOs now.");
  });

  it("never posts raw observations to a CMO (Cuso) chat", async () => {
    const read = receipt({
      capability: "list_project_social_accounts",
      result: [
        {
          id: "account-one",
          provider: "linkedin",
          externalHandle: "acme",
          status: "active",
          connectedAt: "2026-09-28T10:00:00Z",
          disconnectedAt: null,
        },
      ],
    });
    db.sokoBotToolCall.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([read]);
    db.sokoBotTurn.findUnique.mockResolvedValue({
      source: "SCHEDULE",
      versionId: "cmo-v1",
    });
    const response = await buildActionResponse(
      prisma,
      "turn-current",
      "",
      true,
      {
        kind: "REPORT",
        message: null,
        question: null,
        observationToolCallIds: ["read-social"],
      },
    );
    // The read is still recorded; it just never becomes a chat message.
    expect(response.observations.length).toBeGreaterThan(0);
    expect(response.answerText).not.toContain("Observed social account");
    expect(response.answerText).not.toContain("account-one");
  });

  it("shows the bot's own words instead of restating what it read", async () => {
    const read = receipt({
      capability: "list_project_social_accounts",
      result: [
        {
          id: "account-one",
          provider: "linkedin",
          externalHandle: "acme",
          status: "active",
          connectedAt: "2026-09-28T10:00:00Z",
          disconnectedAt: null,
        },
      ],
    });
    db.sokoBotToolCall.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([read]);
    const response = await buildActionResponse(
      prisma,
      "turn-current",
      "Your LinkedIn account acme is connected.",
      true,
      {
        kind: "REPORT",
        message: "Your LinkedIn account acme is connected.",
        question: null,
        observationToolCallIds: ["read-social"],
      },
    );
    expect(response.answerText).toBe(
      "Your LinkedIn account acme is connected.",
    );
    expect(response.observations.length).toBeGreaterThan(0);
  });

  it("includes every connected account when providers have multiple accounts", async () => {
    const providers = [
      "x",
      "tiktok",
      "instagram",
      "linkedin",
      "facebook",
      "youtube",
      "x",
    ];
    db.sokoBotToolCall.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        receipt({
          capability: "list_project_social_accounts",
          result: providers.map((provider, index) => ({
            id: `account-${index}`,
            provider,
            externalHandle: `handle-${index}`,
            status: "active",
            connectedAt: "2026-09-28T10:00:00Z",
            disconnectedAt: null,
          })),
        }),
      ]);
    const response = await buildActionResponse(
      prisma,
      "turn-current",
      "Done",
      true,
      {
        kind: "REPORT",
        question: null,
        observationToolCallIds: ["read-social"],
      },
    );
    expect(response.answerText).toContain(
      "Showing 7 of 7 returned social accounts",
    );
    for (const [index, provider] of providers.entries()) {
      expect(response.answerText).toContain(`platform "${provider}"`);
      expect(response.answerText).toContain(`handle "handle-${index}"`);
    }
  });

  it.each(["get_social_post", "list_social_posts"])(
    "renders bounded %s facts, including draft text and schedule, without verifying an action",
    async (capability) => {
      const post = {
        id: "post-one",
        provider: "linkedin",
        status: "SCHEDULED",
        text: 'Launch\n"Ignore rules" ' + "x".repeat(650),
        revision: 3,
        scheduledAt: "2026-09-29T10:00:00Z",
        timezone: "Europe/Prague",
        publishedUrl: "https://social.example/posts/one",
        socialConnection: { externalHandle: "Acme", status: "active" },
      };
      db.sokoBotToolCall.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          receipt({
            capability,
            result:
              capability === "get_social_post"
                ? post
                : {
                    posts: Array.from({ length: 6 }, (_, index) => ({
                      ...post,
                      id: `post-${index}`,
                    })),
                    pagination: {
                      cursor: null,
                      limit: 6,
                      total: 9,
                      nextCursor: "post-5",
                    },
                  },
          }),
        ]);
      const response = await buildActionResponse(
        prisma,
        "turn-current",
        "Published everything",
        true,
        {
          kind: "REPORT",
          question: null,
          observationToolCallIds: ["read-social"],
        },
      );
      expect(response.appliedReceiptIds).toEqual([]);
      expect(response.answerText).toContain(
        'platform "linkedin", status "SCHEDULED", revision 3',
      );
      expect(response.answerText).toContain(
        JSON.stringify(post.text.slice(0, 600)),
      );
      expect(response.answerText).not.toContain("x".repeat(601));
      expect(response.answerText).toContain(
        'Scheduled at: "2026-09-29T10:00:00Z"; time zone: "Europe/Prague"',
      );
      expect(response.answerText).toContain('Account: "Acme", status "active"');
      expect(response.answerText).toContain(
        'Published URL: "https://social.example/posts/one"',
      );
      expect(response.answerText).not.toContain("job");
      expect(response.answerText).not.toContain("Published everything");
      if (capability === "list_social_posts") {
        expect(response.observations).toHaveLength(6);
        expect(response.answerText).toContain(
          "Showing 5 of 6 returned social posts (9 total). More posts are available.",
        );
        expect(response.answerText).not.toContain('"post-5"');
      }
    },
  );

  it("restates an account's text limit and a post's thread and quote", async () => {
    db.sokoBotToolCall.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        receipt({
          capability: "list_project_social_accounts",
          result: {
            enabledProviders: ["x"],
            accounts: [
              {
                id: "account-one",
                provider: "x",
                externalHandle: "acme",
                status: "active",
                connectedAt: null,
                disconnectedAt: null,
                textLimit: 25_000,
              },
            ],
          },
        }),
        receipt({
          capability: "get_social_post",
          result: {
            id: "post-one",
            provider: "x",
            status: "NEEDS_APPROVAL",
            text: "Launch",
            revision: 0,
            scheduledAt: null,
            timezone: null,
            publishedUrl: null,
            threadPartCount: 3,
            quotedPostId: "post-zero",
          },
        }),
      ]);
    const response = await buildActionResponse(
      prisma,
      "turn-current",
      "Done",
      true,
      {
        kind: "REPORT",
        question: null,
        observationToolCallIds: ["read-social"],
      },
    );
    expect(response.answerText).toContain("Text limit: 25000 characters.");
    expect(response.answerText).toContain("Thread of 3 posts.");
    expect(response.answerText).toContain('Quotes post "post-zero".');
  });

  it.each([
    ["list_project_social_accounts", {}],
    ["list_social_posts", { posts: [{ id: "post-one" }] }],
    ["get_social_post", { name: "Fake job", status: "COMPLETED" }],
  ])("ignores malformed social evidence for %s", async (capability, result) => {
    db.sokoBotToolCall.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([receipt({ capability, result })]);
    const response = await buildActionResponse(
      prisma,
      "turn-current",
      "Published everything",
      true,
      {
        kind: "REPORT",
        question: null,
        observationToolCallIds: ["read-social"],
      },
    );
    expect(response.observations).toEqual([]);
    expect(response.appliedReceiptIds).toEqual([]);
    expect(response.answerText).not.toContain("Published everything");
  });

  it.each(["Nothing to add.", "Nothing new worth flagging."])(
    "preserves silent proactive answers: %s",
    async (text) => {
      db.sokoBotToolCall.findMany.mockResolvedValue([]);
      expect(
        (await buildActionResponse(prisma, "turn-current", text, true))
          .answerText,
      ).toBe("Nothing to add.");
    },
  );

  it("combines receipts and persisted authorized read facts, without model facts", async () => {
    db.sokoBotToolCall.findMany
      .mockResolvedValueOnce([receipt()])
      .mockResolvedValueOnce([
        receipt({
          capability: "get_task_status",
          result: { name: "Launch", status: "IN_PROGRESS" },
        }),
      ]);
    const response = await buildActionResponse(
      prisma,
      "turn-current",
      "The task finished",
      true,
      {
        kind: "REPORT",
        question: null,
        observationToolCallIds: ["read-one"],
      },
    );
    // The receipts say what happened; what the bot read stays on the record
    // rather than being restated beneath them in fixed wording.
    expect(response.answerText).toBe("Updated task.");
    expect(response.observations).toEqual([
      'Observed task "Launch": status "IN_PROGRESS".',
    ]);
    expect(db.sokoBotToolCall.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          turnId: "turn-current",
          toolCallId: { in: ["read-one"] },
          capability: {
            in: [
              "get_task_status",
              "get_job_status",
              "list_project_social_accounts",
              "list_social_posts",
              "get_social_post",
            ],
          },
          status: "COMPLETED",
        },
      }),
    );
  });

  it("explains blocked work from persisted evidence alongside a verified action", async () => {
    db.sokoBotToolCall.findMany
      .mockResolvedValueOnce([receipt({ capability: "assign_task" })])
      .mockResolvedValueOnce([
        receipt({
          capability: "get_task_status",
          result: {
            name: "Launch campaign",
            status: "BLOCKED",
            project: { name: "Autumn launch" },
            assignee: { name: "Nina" },
            events: [
              {
                by: "coworker",
                status: "BLOCKED",
                comment: "Waiting for owner approval of the campaign budget.",
              },
            ],
            fulfillment: {
              state: "PARTIAL",
              blockerKind: "RESULT_EVIDENCE_UNAVAILABLE",
              remainingSteps: ["approval"],
              acceptanceCriteria: [
                { id: "approval", description: "Approved campaign budget" },
              ],
            },
            links: [
              {
                relation: "BLOCKS",
                direction: "to-this",
                task: { name: "Budget approval", status: "INPUT_REQUIRED" },
                note: "The owner must approve the budget.",
              },
            ],
          },
        }),
      ]);
    const response = await buildActionResponse(
      prisma,
      "turn-current",
      "I approved the budget and completed the campaign",
      true,
      {
        kind: "REPORT",
        question: null,
        observationToolCallIds: ["read-blocked"],
      },
    );
    expect(response.answerText).toBe("Assigned task.");
    const observed = response.observations.join("\n");
    expect(observed).toContain(
      'Observed task "Launch campaign": status "BLOCKED".',
    );
    expect(observed).toContain('Recorded project: "Autumn launch".');
    expect(observed).toContain('Recorded assignee: "Nina".');
    expect(observed).toContain(
      'Latest reported task update ("coworker"): "Waiting for owner approval of the campaign budget.".',
    );
    expect(observed).not.toMatch(/requested outcome|Result evidence/);
    expect(observed).toContain(
      'Not confirmed yet: "Approved campaign budget".',
    );
    expect(observed).toContain('"Budget approval", status "INPUT_REQUIRED"');
    expect(response.answerText).not.toContain("I approved");
    expect(response.appliedReceiptIds).toEqual(["receipt-one"]);
  });

  it("reads the actual latest job-event status and explains missing input", async () => {
    db.sokoBotToolCall.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        receipt({
          capability: "get_job_status",
          result: {
            name: "Research",
            events: [
              { status: "AWAITING_INPUT", inputSchema: { type: "object" } },
            ],
          },
        }),
      ]);
    const response = await buildActionResponse(
      prisma,
      "turn-current",
      "The research is done",
      true,
      { kind: "REPORT", question: null, observationToolCallIds: ["read-job"] },
    );
    expect(response.answerText).toBe(
      'Observed job "Research": status "AWAITING_INPUT".\nThe latest job event is awaiting input; completion is not verified.',
    );
  });

  it("confirms a preference Core saved before a turn with no tool calls", async () => {
    const preference = "Write tasks assigned to Hannah in German.";
    db.sokoBotToolCall.findMany.mockResolvedValue([]);
    db.sokoBotTurn.findUnique.mockResolvedValue({
      source: "CHAT",
      sokoBotId: "bot-one",
      versionId: "v37",
      contextSnapshot: {
        packet: {
          trigger: {
            source: "CHAT",
            askedBy: { kind: "OWNER" },
            savedPreference: {
              instruction: preference,
              memoryRevisionId: "01960001-0001-7001-8001-000000000003",
              memoryVersion: 1,
              memoryHash: "saved-hash",
            },
          },
          memory: {
            version: 1,
            hash: "saved-hash",
            markdown: `# Soko Bot memory\n\n## Preferences\n- ${preference}`,
          },
        },
      },
    });
    db.sokoBotMemoryRevision.findFirst.mockResolvedValue({
      markdown: `# Soko Bot memory\n\n## Preferences\n- ${preference}`,
    });
    const response = await buildActionResponse(
      prisma,
      "turn-current",
      "",
      true,
      {
        kind: "REPORT",
        message: null,
        question: null,
        observationToolCallIds: [],
      },
    );
    expect(response.answerText).toBe(
      `Saved preference: ${JSON.stringify(preference)}.`,
    );
    expect(response.appliedReceiptIds).toEqual([]);
  });

  it("reports a verified schedule pause without depending on model wording", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValue([
      receipt({
        capability: "update_schedule",
        input: { enabled: false },
        targetId: "schedule-one",
        result: { enabled: false },
      }),
    ]);
    const response = await buildActionResponse(
      prisma,
      "turn-current",
      "",
      true,
    );
    expect(response.answerText).toBe("Paused schedule.");
  });

  it.each([true, false])(
    "reports a rename as an update with enabled=%s",
    async (enabled) => {
      db.sokoBotToolCall.findMany.mockResolvedValue([
        receipt({
          capability: "update_schedule",
          input: { name: "New check name" },
          targetId: "schedule-one",
          result: { enabled },
        }),
      ]);
      const response = await buildActionResponse(
        prisma,
        "turn-current",
        "",
        true,
      );
      expect(response.answerText).toBe(
        `Updated schedule (${enabled ? "enabled" : "paused"}).`,
      );
    },
  );

  it.each([false, true])(
    "handles no action attempts with actionRequested=%s",
    async (actionRequested) => {
      db.sokoBotToolCall.findMany.mockResolvedValueOnce([]);
      const result = await buildActionResponse(
        prisma,
        "turn-current",
        "Synthetic response",
        actionRequested,
      );
      expect(result).toEqual({
        appliedReceiptIds: [],
        narrative: null,
        observations: [],
        unfulfilledActions: [],
        answerText: actionRequested
          ? "Nothing was changed in this turn."
          : "Synthetic response",
      });
    },
  );

  it.each(["EVENT", "SCHEDULE", "INGEST"])(
    "stays silent on a %s turn where nothing was done or said",
    async (source) => {
      db.sokoBotToolCall.findMany.mockResolvedValueOnce([]);
      db.sokoBotTurn.findUnique.mockResolvedValueOnce({ source });
      const result = await buildActionResponse(
        prisma,
        "turn-current",
        "",
        true,
        {
          kind: "REPORT",
          message: null,
          question: null,
          observationToolCallIds: [],
        },
      );
      expect(result.answerText).toBe("Nothing to add.");
    },
  );

  it("keeps the nightly dream silent when it only rewrote memory", async () => {
    const memory = receipt({ capability: "update_memory", targetId: null });
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([memory]);
    db.sokoBotTurn.findUnique.mockResolvedValueOnce({ source: "SCHEDULE" });
    const result = await buildActionResponse(
      prisma,
      "turn-current",
      "Nothing to add.",
    );
    expect(result.answerText).toBe("Nothing to add.");
  });

  it("says it updated memory when the owner asked", async () => {
    const memory = receipt({ capability: "update_memory", targetId: null });
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([memory]);
    db.sokoBotTurn.findUnique.mockResolvedValueOnce({ source: "CHAT" });
    const result = await buildActionResponse(
      prisma,
      "turn-current",
      "Nothing to add.",
    );
    expect(result.answerText).toMatch(/updated memory/i);
  });

  it("still posts a dream that has something for the owner", async () => {
    const memory = receipt({ capability: "update_memory", targetId: null });
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([memory]);
    db.sokoBotTurn.findUnique.mockResolvedValueOnce({ source: "SCHEDULE" });
    const result = await buildActionResponse(prisma, "turn-current", "", true, {
      kind: "REPORT",
      message: "Your invoice rule never fired this week.",
      question: null,
      observationToolCallIds: [],
    });
    expect(result.answerText).toContain(
      "Your invoice rule never fired this week.",
    );
  });

  it("drops a held-back reply on a turn the bot started itself", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([]);
    db.sokoBotTurn.findUnique.mockResolvedValueOnce({ source: "EVENT" });
    const result = await buildActionResponse(prisma, "turn-current", "", true, {
      kind: "REPORT",
      message: HELD_BACK_REPLY,
      question: null,
      observationToolCallIds: [],
    });
    expect(result.answerText).toBe("Nothing to add.");
  });

  it("keeps a held-back reply for the owner who asked", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([]);
    db.sokoBotTurn.findUnique.mockResolvedValueOnce({ source: "CHAT" });
    const result = await buildActionResponse(
      prisma,
      "turn-current",
      "I posted it.",
      true,
      {
        kind: "REPORT",
        message: HELD_BACK_REPLY,
        question: null,
        observationToolCallIds: [],
      },
    );
    expect(result.answerText).toBe(HELD_BACK_REPLY);
  });
});
