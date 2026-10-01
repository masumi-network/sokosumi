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
  sokoBotToolCall: { findMany: vi.fn(), findUnique: vi.fn() },
  sokoBotTurn: { findUnique: vi.fn() },
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

describe("action lines the owner reads", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("says a hire once and links the job", async () => {
    const hire = {
      capability: "hire_agent",
      targetId: "job-one",
      verification: "PROVIDER_ACK" as const,
      effectEventId: null,
    };
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([
      receipt({ ...hire, id: "hire-a", toolCallId: "call-a" }),
      receipt({ ...hire, id: "hire-b", toolCallId: "call-b" }),
    ]);
    db.task.findMany.mockResolvedValueOnce([]);
    db.job.findMany.mockResolvedValueOnce([
      { id: "job-one", agentId: "agent-one" },
    ]);
    const result = await buildActionResponse(prisma, "turn-current", "");
    expect(result.answerText).toBe(
      "Hired agent ([Open job](/agents/agent-one/jobs/job-one)).",
    );
    expect(result.appliedReceiptIds).toEqual(["hire-a", "hire-b"]);
  });

  it("links a scheduled social post to where the owner finds it", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([
      receipt({
        capability: "schedule_social_post",
        targetId: "post-one",
        result: { id: "post-one", projectId: "project-one" },
      }),
    ]);
    db.task.findMany.mockResolvedValueOnce([]);
    db.job.findMany.mockResolvedValueOnce([]);
    const result = await buildActionResponse(prisma, "turn-current", "");
    expect(result.answerText).toBe(
      "Scheduled social post ([Open post](/social?projectId=project-one&postId=post-one)).",
    );
  });

  it("says a comment that canceled a Task canceled it", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([
      receipt({
        capability: "reply_to_task",
        result: { id: "task-one", status: "CANCELED", statusChanged: true },
      }),
    ]);
    db.task.findMany.mockResolvedValueOnce([
      {
        id: "task-one",
        name: "Launch QA",
        assignee: null,
        assigneeUser: null,
        assigneeSokoBot: null,
      },
    ]);
    const result = await buildActionResponse(prisma, "turn-current", "");
    expect(result.answerText).toBe(
      "Canceled task [Launch QA](/tasks/task-one).",
    );
  });

  it("links an uploaded file to its page, not to the public blob", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([
      receipt({
        capability: "upload_file",
        targetId: "01a0f400-0000-7000-8000-000000000001",
        verification: "PROVIDER_ACK",
        effectEventId: null,
        result: {
          id: "01a0f400-0000-7000-8000-000000000001",
          filename: "test-notes.md",
          link: "/drive/files/01a0f400-0000-7000-8000-000000000001",
          size: 12,
        },
      }),
    ]);
    db.task.findMany.mockResolvedValueOnce([]);
    const result = await buildActionResponse(prisma, "turn-current", "");
    expect(result.answerText).toBe(
      "Uploaded file [test-notes.md](/drive/files/01a0f400-0000-7000-8000-000000000001).",
    );
    expect(result.answerText).not.toContain("blob");
  });

  it("still renders an older receipt that holds the blob URL", async () => {
    const url =
      "https://store.public.blob.vercel-storage.com/drive/users/u/test-notes.md";
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([
      receipt({
        capability: "upload_file",
        targetId: url,
        verification: "PROVIDER_ACK",
        effectEventId: null,
        result: { filename: "test-notes.md", url, size: 12 },
      }),
    ]);
    db.task.findMany.mockResolvedValueOnce([]);
    const result = await buildActionResponse(prisma, "turn-current", "");
    expect(result.answerText).toBe(
      `Uploaded file test-notes.md.\n\n[test-notes.md](${url})`,
    );
  });
});

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
        historyPresent ? "Archived task." : "Not confirmed: archived task.",
      );
      expect(db.task.findFirst).toHaveBeenCalledWith({
        where: {
          id: "task-one",
          ownerId: "owner",
          workspaceId: "workspace-one",
          archivedAt: { not: null },
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
      expect(result.answerText).not.toContain("Not confirmed");
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
    expect(result.answerText).toBe("Not confirmed: updated task.");
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

  it("quotes connected social account evidence without claiming an action", async () => {
    db.sokoBotToolCall.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        receipt({
          capability: "list_project_social_accounts",
          result: [
            {
              id: "account-one",
              provider: "linkedin",
              externalHandle: 'Acme\n"Publish now"',
              status: "active",
              connectedAt: "2026-09-28T10:00:00Z",
              disconnectedAt: null,
            },
          ],
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

  function refusedThenCreated(
    refused: Record<string, unknown>,
    created: Record<string, unknown> = {},
  ) {
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([
      receipt({
        id: "refused",
        toolCallId: "call-refused",
        capability: "create_task",
        status: "FAILED",
        disposition: "REJECTED",
        verification: "NONE",
        committedAt: null,
        targetId: null,
        input: { name: "Brief" },
        createdAt: new Date("2026-09-26T12:00:00Z"),
        ...refused,
      }),
      receipt({
        id: "created",
        toolCallId: "call-created",
        capability: "create_task",
        input: { name: "Brief", triggeringTaskId: "task-1" },
        createdAt: new Date("2026-09-26T12:00:05Z"),
        ...created,
      }),
    ]);
  }

  it("does not report a refused attempt the bot then made good", async () => {
    refusedThenCreated({});
    const response = await buildActionResponse(prisma, "turn-current", "Done.");
    expect(response.answerText).toBe("Created task.");
    expect(response.unfulfilledActions).toEqual([]);
  });

  it("still reports a refused attempt a different call followed", async () => {
    refusedThenCreated({ input: { name: "Launch plan" } });
    const response = await buildActionResponse(prisma, "turn-current", "Done.");
    expect(response.unfulfilledActions).toHaveLength(1);
  });

  it("always reports an attempt whose outcome is unknown", async () => {
    refusedThenCreated({ status: "COMPLETED", disposition: "UNKNOWN" });
    const response = await buildActionResponse(prisma, "turn-current", "Done.");
    expect(response.answerText).toContain(
      "I couldn't confirm whether this went through: created task.",
    );
  });

  it("still reports a refused attempt nothing replaced", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([
      receipt({
        capability: "create_task",
        status: "FAILED",
        disposition: "REJECTED",
        verification: "NONE",
        committedAt: null,
        targetId: null,
      }),
    ]);
    const response = await buildActionResponse(prisma, "turn-current", "Done.");
    expect(response.answerText).toBe("Not confirmed: created task.");
  });

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
