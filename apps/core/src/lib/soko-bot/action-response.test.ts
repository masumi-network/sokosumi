import type { SokoBotToolCall } from "@sokosumi/database";
import { ACTION_LABELS } from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/db/prisma";
import {
  ACTION_CAPABILITIES,
  ACTION_RECEIPT_CAPABILITIES,
} from "./action-receipts";
import {
  buildActionResponse,
  HELD_BACK_REPLY,
  parseActionNarrativeText,
  REPLY_CHECK_NOTES,
} from "./action-response";

const db = vi.hoisted(() => ({
  sokoBotToolCall: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
  sokoBotTurn: { findUnique: vi.fn() },
  task: { findFirst: vi.fn(), findMany: vi.fn() },
  job: { findMany: vi.fn() },
}));
vi.mock("@/lib/db/prisma", () => ({ default: db }));
const showAccountQuestion = vi.hoisted(() => vi.fn());
vi.mock("./account-question", () => ({
  ACCOUNT_QUESTION_HEADING: "Which account should this go on?",
  showAccountQuestion,
}));

describe("an account question Core asks", () => {
  const QUESTION =
    "Which account should this go on?\n1. @pat (Founder notes)\n2. @acme_hq (Company marketing)";
  const refused = receipt({
    capability: "create_social_post",
    status: "FAILED",
    disposition: "REJECTED",
    verification: "NONE",
    committedAt: null,
    targetId: null,
  });
  const narrative = {
    kind: "REPORT",
    message: "When should the posts go out?",
    question: null,
    observationToolCallIds: [],
  };

  beforeEach(() => {
    vi.resetAllMocks();
    showAccountQuestion.mockResolvedValue(QUESTION);
    db.sokoBotToolCall.findMany.mockResolvedValue([]);
    db.sokoBotToolCall.findUnique.mockResolvedValue(null);
    db.sokoBotToolCall.count.mockResolvedValue(0);
    db.sokoBotTurn.findUnique.mockResolvedValue({
      source: "CHAT",
      parentTurnId: null,
      versionId: "v39",
    });
    db.task.findFirst.mockResolvedValue(null);
    db.task.findMany.mockResolvedValue([]);
    db.job.findMany.mockResolvedValue([]);
  });

  it("goes under the reply of the turn whose draft was refused, whatever else the reply asks", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([refused]);
    const response = await buildActionResponse(
      prisma,
      "turn-current",
      "",
      true,
      narrative,
    );
    expect(showAccountQuestion).toHaveBeenCalledWith(
      prisma,
      "turn-current",
      true,
    );
    expect(response.answerText).toContain("When should the posts go out?");
    expect(response.answerText.endsWith(QUESTION)).toBe(true);
  });

  it("goes in once when settlement rebuilds an answer that holds it", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([refused]);
    const response = await buildActionResponse(
      prisma,
      "turn-current",
      `Nothing drafted yet.\n\n${QUESTION}`,
    );
    expect(response.answerText.split(QUESTION)).toHaveLength(2);
  });

  it("leaves the earlier question out of a rebuild that can no longer show it", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([refused]);
    showAccountQuestion.mockResolvedValueOnce(null);
    const response = await buildActionResponse(
      prisma,
      "turn-current",
      `Nothing drafted yet.\n\n${QUESTION}`,
    );
    expect(showAccountQuestion).toHaveBeenCalledWith(
      prisma,
      "turn-current",
      true,
    );
    expect(response.answerText).not.toContain("Which account");
  });

  it("keeps an ordinary reply whole, even one with the same question in it", async () => {
    const message =
      "Two items for the intake form:\n\nWhich account should this go on?\n\nWho should approve the budget?";
    const response = await buildActionResponse(prisma, "turn-current", message);
    expect(response.answerText).toBe(message);
    expect(showAccountQuestion).not.toHaveBeenCalled();
  });

  it("on a refused draft, replaces only Core's own block at the end and keeps the bot's words", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([refused]);
    const words =
      "Nothing drafted yet.\n\nWhich account should this go on?\n\nI can also add a picture.";
    const response = await buildActionResponse(
      prisma,
      "turn-current",
      "",
      true,
      { ...narrative, message: words },
    );
    expect(response.answerText).toContain(words);
    expect(response.answerText.split(QUESTION)).toHaveLength(2);
  });

  it("is not looked up on a turn without a refused draft", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([
      receipt({ capability: "create_social_post" }),
    ]);
    await buildActionResponse(prisma, "turn-current", "", true, narrative);
    expect(showAccountQuestion).not.toHaveBeenCalled();
  });
});

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
  it("has words for every action, so no line shows a tool's name", () => {
    expect(
      ACTION_RECEIPT_CAPABILITIES.filter((action) => !ACTION_LABELS[action]),
    ).toEqual([]);
  });

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it.each([
    ["find_investors", "Ran an investor search."],
    ["investor_warm_paths", "Researched the investor's portfolio."],
  ])(
    "describes a verified %s receipt in the owner's reply",
    async (capability, expected) => {
      db.sokoBotToolCall.findMany.mockResolvedValueOnce([
        receipt({ capability }),
      ]);
      const response = await buildActionResponse(prisma, "turn-current", "");
      expect(response.answerText).toBe(expected);
      expect(response.appliedReceiptIds).toEqual(["receipt-one"]);
    },
  );

  it("reports uncertain paid portfolio research and leaves ordinary warm-path reads out of the action report", async () => {
    const capability = "investor_warm_paths";
    const contact = { contactId: "investor-one" };
    const rows = [
      receipt({
        id: "read",
        capability,
        input: contact,
        disposition: null,
        verification: "NONE",
        committedAt: null,
        targetId: null,
      }),
      receipt({
        id: "paid",
        capability,
        input: { ...contact, research: true },
        status: "FAILED",
        disposition: "UNKNOWN",
        verification: "NONE",
        committedAt: null,
        targetId: null,
      }),
    ];
    db.sokoBotToolCall.findMany.mockImplementationOnce(async ({ where }) =>
      rows.filter((row) => where.capability.in.includes(row.capability)),
    );
    const response = await buildActionResponse(prisma, "turn-current", "");
    expect(response.appliedReceiptIds).toEqual([]);
    expect(response.unfulfilledActions).toEqual([
      { action: capability, receiptId: "paid", reason: "UNKNOWN" },
    ]);
    expect(response.answerText).toBe(
      "I couldn't confirm whether this went through: researched the investor's portfolio. Check before trying again.",
    );
  });

  it("links a calendar mailbox to its saved card without linking the name from the question", async () => {
    const email = "studio@cerise.example";
    const link =
      "/contacts?contact=019aaa01-0000-7000-8000-000000000001&workspace=019aaa01-0000-7000-8000-000000000002";
    const event = "[Calendar event](https://calendar.example/events/proof)";
    const text = `I cannot confirm Micah. The invite lists Cerise Desk, using ${email}. ${event}`;
    const calendarRead = receipt({
      capability: "list_calendar_events",
      disposition: null,
      result: { events: [{ contactReferences: [{ email, link }] }] },
    });
    db.sokoBotToolCall.findMany.mockImplementation(async ({ where }) =>
      where.capability.in.includes("list_calendar_events")
        ? [calendarRead]
        : [],
    );
    const result = await buildActionResponse(prisma, "turn-current", text);
    expect(result.answerText).toBe(text.replace(email, `[${email}](${link})`));
    expect(result.appliedReceiptIds).toEqual([]);
  });

  it("links a verified newsletter draft to the editor for human review", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([
      receipt({
        capability: "newsletter_draft_issue",
        targetId: "issue-one",
        result: { projectId, status: "DRAFT" },
      }),
    ]);
    const result = await buildActionResponse(prisma, "turn-current", "");
    expect(result.answerText).toBe(
      `Drafted newsletter issue for review ([Review draft](/newsletter/issues/issue-one?projectId=${projectId}&draftedBySokoBot=true)).`,
    );
    expect(result.appliedReceiptIds).toEqual(["receipt-one"]);
  });

  it.each([
    [
      "create_newsletter_issue",
      "Created newsletter draft ([Open issue](/newsletter/issues/issue-one?projectId={p})).",
    ],
    [
      "update_newsletter_issue",
      "Updated newsletter issue ([Open issue](/newsletter/issues/issue-one?projectId={p})).",
    ],
    [
      "delete_newsletter_issue",
      "Deleted newsletter issue ([Open issues](/newsletter/issues?projectId={p})).",
    ],
    [
      "submit_newsletter_issue",
      "Submitted newsletter issue for approval ([Open issue](/newsletter/issues/issue-one?projectId={p})).",
    ],
    [
      "update_newsletter_settings",
      "Updated newsletter settings ([Open settings](/newsletter/settings?projectId={p})).",
    ],
    [
      "add_newsletter_subscriber",
      "Added newsletter subscriber ([Open subscribers](/newsletter/subscribers?projectId={p})).",
    ],
    [
      "import_newsletter_subscribers",
      "Imported newsletter subscribers ([Open subscribers](/newsletter/subscribers?projectId={p})).",
    ],
    [
      "add_newsletter_subscribers_from_contacts",
      "Added contacts to the newsletter ([Open subscribers](/newsletter/subscribers?projectId={p})).",
    ],
    [
      "update_newsletter_subscriber",
      "Updated newsletter subscriber ([Open subscribers](/newsletter/subscribers?projectId={p})).",
    ],
    [
      "remove_newsletter_subscriber",
      "Removed newsletter subscriber ([Open subscribers](/newsletter/subscribers?projectId={p})).",
    ],
  ])("links a verified %s to the Newsletter", async (capability, line) => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([
      receipt({ capability, targetId: "issue-one", result: { projectId } }),
    ]);
    const result = await buildActionResponse(prisma, "turn-current", "");
    expect(result.answerText).toBe(line.replace("{p}", projectId));
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

  it("collapses repeated Task changes into one line naming up to five", async () => {
    const ids = ["a", "b", "c"];
    db.sokoBotToolCall.findMany.mockResolvedValueOnce(
      ids.map((id) =>
        receipt({
          id: `receipt-${id}`,
          toolCallId: `call-${id}`,
          targetId: id,
        }),
      ),
    );
    db.task.findMany.mockResolvedValueOnce(
      ids.map((id) => ({
        id,
        name: `Task ${id}`,
        assignee: null,
        assigneeUser: null,
        assigneeSokoBot: null,
      })),
    );
    const result = await buildActionResponse(prisma, "turn-current", "");
    expect(result.answerText).toBe(
      "Updated 3 Tasks: [Task a](/tasks/a), [Task b](/tasks/b), [Task c](/tasks/c).",
    );
  });

  it("counts more than five Task changes without naming them", async () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    db.sokoBotToolCall.findMany.mockResolvedValueOnce(
      ids.map((id) =>
        receipt({
          id: `receipt-${id}`,
          toolCallId: `call-${id}`,
          targetId: id,
        }),
      ),
    );
    db.task.findMany.mockResolvedValueOnce(
      ids.map((id) => ({
        id,
        name: `Task ${id}`,
        assignee: null,
        assigneeUser: null,
        assigneeSokoBot: null,
      })),
    );
    const result = await buildActionResponse(prisma, "turn-current", "");
    expect(result.answerText).toBe("Updated 6 Tasks.");
  });

  it("says repeated refused archives once, with a count", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValueOnce(
      Array.from({ length: 9 }, (_, index) =>
        receipt({
          id: `receipt-${index}`,
          toolCallId: `call-${index}`,
          capability: "archive_task",
          status: "FAILED",
          disposition: "REJECTED",
          verification: "NONE",
          committedAt: null,
          targetId: null,
          input: { taskId: `task-${index}` },
        }),
      ),
    );
    db.task.findMany.mockResolvedValueOnce([]);
    db.sokoBotTurn.findUnique.mockResolvedValue({ source: "CHAT" });
    const result = await buildActionResponse(prisma, "turn-current", "");
    expect(result.answerText).toBe("Couldn't archive 9 Tasks.");
    expect(result.unfulfilledActions).toHaveLength(9);
  });

  it("counts a retried archive once and names the few Tasks it missed", async () => {
    const refused = (index: number, taskId: string) =>
      receipt({
        id: `receipt-${index}`,
        toolCallId: `call-${index}`,
        capability: "archive_task",
        status: "FAILED",
        disposition: "REJECTED",
        verification: "NONE",
        committedAt: null,
        targetId: null,
        input: { taskId },
      });
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([
      refused(0, "a"),
      refused(1, "a"),
      refused(2, "a"),
      refused(3, "b"),
    ]);
    db.task.findMany.mockResolvedValueOnce(
      ["a", "b"].map((id) => ({
        id,
        name: `Test task ${id}`,
        assignee: null,
        assigneeUser: null,
        assigneeSokoBot: null,
      })),
    );
    db.sokoBotTurn.findUnique.mockResolvedValue({ source: "CHAT" });
    const result = await buildActionResponse(prisma, "turn-current", "");
    expect(result.answerText).toBe(
      "Couldn't archive 2 Tasks: [Test task a](/tasks/a), [Test task b](/tasks/b).",
    );
    expect(result.unfulfilledActions).toHaveLength(4);
  });

  it("drops a talking video refused for its price once a shorter one starts", async () => {
    const video = (presenter: string) => [
      receipt({
        id: "receipt-refused",
        toolCallId: "call-refused",
        capability: "generate_talking_video",
        status: "FAILED",
        disposition: "REJECTED",
        verification: "NONE",
        committedAt: null,
        targetId: null,
        input: {
          projectId: "project-1",
          presenter: "maya",
          script: "A long script that costs too much.",
          maxCredits: 250,
        },
      }),
      receipt({
        id: "receipt-started",
        toolCallId: "call-started",
        capability: "generate_talking_video",
        targetId: "job-1",
        createdAt: new Date("2026-09-26T12:01:00Z"),
        input: {
          projectId: "project-1",
          presenter,
          script: "A shorter script.",
          maxCredits: 250,
        },
      }),
    ];
    db.sokoBotTurn.findUnique.mockResolvedValue({ source: "CHAT" });

    db.sokoBotToolCall.findMany.mockResolvedValueOnce(video("maya"));
    const retried = await buildActionResponse(prisma, "turn-current", "");
    expect(retried.answerText).not.toContain("Not confirmed");

    // Another presenter is another video: the refused one still counts.
    db.sokoBotToolCall.findMany.mockResolvedValueOnce(video("jonas"));
    const other = await buildActionResponse(prisma, "turn-current", "");
    expect(other.answerText).toContain("Not confirmed");
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

  it("says a comment that completed a Task completed it", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([
      receipt({
        capability: "reply_to_task",
        result: { id: "task-one", status: "COMPLETED", statusChanged: true },
      }),
    ]);
    db.task.findMany.mockResolvedValueOnce([
      {
        id: "task-one",
        name: "TOKEN2049 form",
        assignee: null,
        assigneeUser: null,
        assigneeSokoBot: null,
      },
    ]);
    const result = await buildActionResponse(prisma, "turn-current", "");
    expect(result.answerText).toBe(
      "Completed task [TOKEN2049 form](/tasks/task-one).",
    );
  });

  it("names the contacts and lists a bot changed", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([
      receipt({
        id: "contact-a",
        toolCallId: "call-a",
        capability: "upsert_contact",
        targetId: "contact-one",
        effectEventId: null,
        result: { contact: { name: "Nina [Acme] Keller" }, created: true },
      }),
      receipt({
        id: "contact-b",
        toolCallId: "call-b",
        capability: "upsert_contact",
        targetId: "contact-two",
        effectEventId: null,
        result: { contact: { name: "Tom Berger" }, created: false },
      }),
      receipt({
        id: "list-a",
        toolCallId: "call-c",
        capability: "manage_contact_lists",
        targetId: "list-one",
        effectEventId: null,
        result: { id: "list-one", name: "Investors", count: 2 },
      }),
      receipt({
        id: "log-a",
        toolCallId: "call-d",
        capability: "log_contact_interaction",
        targetId: "contact-one",
        effectEventId: null,
        result: { interaction: { id: "i1" }, created: true },
      }),
    ]);
    db.task.findMany.mockResolvedValueOnce([]);
    const result = await buildActionResponse(prisma, "turn-current", "");
    expect(result.answerText).toBe(
      [
        "Saved contact (2×): Nina \\[Acme\\] Keller, Tom Berger.",
        "Updated contact list Investors.",
        "Logged a contact interaction.",
      ].join("\n"),
    );
    for (const capability of [
      "upsert_contact",
      "update_contact",
      "log_contact_interaction",
      "merge_contacts",
      "manage_contact_lists",
    ])
      expect(ACTION_CAPABILITIES.has(capability)).toBe(true);
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
        capability: {
          in: [...ACTION_RECEIPT_CAPABILITIES, "list_calendar_events"],
        },
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
    // On a schedule the card says it all: a sentence beside it repeats it.
    expect(cuso.answerText).toBe("Nothing to add.");

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

  it("never shows Cuso's owner the receipt lines beside his own words", async () => {
    const updated = receipt({
      capability: "update_social_post",
      targetId: "post-one",
    });
    db.sokoBotTurn.findUnique.mockResolvedValue({
      source: "EVENT",
      versionId: "cmo-v8",
    });
    db.sokoBotToolCall.count.mockResolvedValue(0);
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([updated]);
    const cuso = await buildActionResponse(prisma, "turn-current", "", true, {
      kind: "REPORT",
      message: "The first week's posts are written.",
      question: null,
      observationToolCallIds: [],
    });
    expect(cuso.answerText).toBe("The first week's posts are written.");
  });

  it("shows Cuso's receipt lines when Core cut his words", async () => {
    const updated = receipt({
      capability: "update_social_post",
      targetId: "post-one",
    });
    db.sokoBotTurn.findUnique.mockResolvedValue({
      source: "EVENT",
      versionId: "cmo-v8",
    });
    db.sokoBotToolCall.count.mockResolvedValue(0);
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([updated]);
    // His sentence about the edit was the one cut; the receipt says it.
    const cuso = await buildActionResponse(prisma, "turn-current", "", true, {
      kind: "REPORT",
      message: "The second week waits for your pictures.",
      question: null,
      observationToolCallIds: [],
      replyCheck: "cut",
    });
    expect(cuso.answerText).toContain("Updated social post");
    expect(cuso.answerText).toContain(
      "The second week waits for your pictures.",
    );
    expect(cuso.answerText).toContain(REPLY_CHECK_NOTES.cut);
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

  it("keeps Cuso's answer after he saved SEO suggestions", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([]);
    db.sokoBotTurn.findUnique.mockResolvedValue({
      source: "CHAT",
      versionId: "cmo-v12",
    });
    db.sokoBotToolCall.count.mockImplementation(
      async (args: { where: { capability: unknown } }) =>
        JSON.stringify(args.where.capability).includes("save_seo_suggestions")
          ? 1
          : 0,
    );
    const response = await buildActionResponse(
      prisma,
      "turn-current",
      "Clicks are up 12%. I saved a new homepage title; it is on the SEO page.",
      true,
    );
    expect(response.answerText).toBe(
      "Clicks are up 12%. I saved a new homepage title; it is on the SEO page.",
    );
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

  it("does not report a file refused for its name, then made under another", async () => {
    const voiceover = { text: "Sonntag im Haus Hiltl", folder: "Video" };
    refusedThenCreated(
      {
        capability: "generate_voiceover",
        input: { ...voiceover, filename: "stimme.mp3" },
      },
      {
        capability: "generate_voiceover",
        input: { ...voiceover, filename: "stimme-final.mp3" },
      },
    );
    const response = await buildActionResponse(prisma, "turn-current", "Done.");
    expect(response.unfulfilledActions).toEqual([]);
    expect(response.answerText).not.toContain("Not confirmed");
  });

  it("still reports a refused attempt a different call followed", async () => {
    refusedThenCreated({ input: { name: "Launch plan" } });
    const response = await buildActionResponse(prisma, "turn-current", "Done.");
    expect(response.unfulfilledActions).toHaveLength(1);
  });

  it("suppresses a rejected send_message when a later retry to the same recipient succeeded", async () => {
    refusedThenCreated(
      {
        capability: "send_message",
        input: {
          to: "CodePat",
          projectId: "bad-project",
          message: "Please check the architecture post.",
        },
      },
      {
        capability: "send_message",
        targetId: "msg-1",
        input: {
          to: "@codepat",
          message: "Please check the architecture post.",
        },
      },
    );
    const response = await buildActionResponse(prisma, "turn-current", "Done.");
    expect(response.answerText).toBe("Sent a message.");
    expect(response.answerText).not.toContain("Not confirmed");
    expect(response.unfulfilledActions).toEqual([]);
  });

  it("still reports a rejected send_message to a different recipient", async () => {
    refusedThenCreated(
      {
        capability: "send_message",
        input: { to: "Hannah", message: "Can you review?" },
      },
      {
        capability: "send_message",
        targetId: "msg-2",
        input: { to: "CodePat", message: "Can you review?" },
      },
    );
    const response = await buildActionResponse(prisma, "turn-current", "Done.");
    expect(response.unfulfilledActions).toHaveLength(1);
    expect(response.answerText).toContain("Not confirmed: sent a message.");
  });

  it("never suppresses an UNKNOWN send_message even when a later call to the same recipient succeeded", async () => {
    refusedThenCreated(
      {
        capability: "send_message",
        status: "COMPLETED",
        disposition: "UNKNOWN",
        input: { to: "CodePat", message: "Check this." },
      },
      {
        capability: "send_message",
        targetId: "msg-3",
        input: { to: "CodePat", message: "Check this." },
      },
    );
    const response = await buildActionResponse(prisma, "turn-current", "Done.");
    expect(response.unfulfilledActions).toHaveLength(1);
    expect(response.answerText).toContain(
      "I couldn't confirm whether this went through: sent a message.",
    );
  });

  it("still reports a rejected send_message that happened after an earlier success to the same recipient", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([
      receipt({
        id: "sent-first",
        toolCallId: "call-sent",
        capability: "send_message",
        targetId: "msg-first",
        input: { to: "CodePat", message: "Part 1" },
        createdAt: new Date("2026-09-26T12:00:00Z"),
      }),
      receipt({
        id: "refused-later",
        toolCallId: "call-refused",
        capability: "send_message",
        status: "FAILED",
        disposition: "REJECTED",
        verification: "NONE",
        committedAt: null,
        targetId: null,
        input: { to: "CodePat", message: "Part 2" },
        createdAt: new Date("2026-09-26T12:00:05Z"),
      }),
    ]);
    const response = await buildActionResponse(prisma, "turn-current", "Done.");
    expect(response.unfulfilledActions).toHaveLength(1);
    expect(response.answerText).toContain("Not confirmed: sent a message.");
  });

  it("still reports a rejected send_message when a later send to the same recipient carries a different message", async () => {
    refusedThenCreated(
      {
        capability: "send_message",
        input: { to: "CodePat", message: "Review the launch plan" },
      },
      {
        capability: "send_message",
        targetId: "msg-diff",
        input: { to: "CodePat", message: "Send the invoice" },
      },
    );
    const response = await buildActionResponse(prisma, "turn-current", "Done.");
    expect(response.unfulfilledActions).toHaveLength(1);
    expect(response.answerText).toContain("Not confirmed: sent a message.");
  });

  it("does not conflate a #room address with a person of the same name", async () => {
    refusedThenCreated(
      {
        capability: "send_message",
        input: { to: "#Jordan", message: "Review the launch plan" },
      },
      {
        capability: "send_message",
        targetId: "msg-person",
        input: { to: "Jordan", message: "Review the launch plan" },
      },
    );
    const response = await buildActionResponse(prisma, "turn-current", "Done.");
    expect(response.unfulfilledActions).toHaveLength(1);
    expect(response.answerText).toContain("Not confirmed: sent a message.");
  });

  it("still reports a rejected structured handoff when a later handoff has the same opener but a different request goal", async () => {
    refusedThenCreated(
      {
        capability: "send_message",
        input: {
          to: "CodePat",
          message: "Please take this.",
          request: {
            goal: "Architecture review",
            deliverable: "X draft",
          },
        },
      },
      {
        capability: "send_message",
        targetId: "msg-req-2",
        input: {
          to: "CodePat",
          message: "Please take this.",
          request: {
            goal: "Release checklist",
            deliverable: "PR comment",
          },
        },
      },
    );
    const response = await buildActionResponse(prisma, "turn-current", "Done.");
    expect(response.unfulfilledActions).toHaveLength(1);
    expect(response.answerText).toContain("Not confirmed: sent a message.");
  });

  it("suppresses a rejected structured handoff retried with the same request after dropping a bad projectId", async () => {
    refusedThenCreated(
      {
        capability: "send_message",
        input: {
          to: "CodePat",
          projectId: "bad-project",
          message: "Please take this.",
          request: {
            goal: "Architecture review",
            deliverable: "X draft",
          },
        },
      },
      {
        capability: "send_message",
        targetId: "msg-req-ok",
        input: {
          to: "@codepat",
          message: "Please take this.",
          request: {
            goal: "Architecture review",
            deliverable: "X draft",
          },
        },
      },
    );
    const response = await buildActionResponse(prisma, "turn-current", "Done.");
    expect(response.unfulfilledActions).toEqual([]);
    expect(response.answerText).toBe("Sent a message.");
  });

  it("suppresses a rejected post_chat, open_direct_chat, or ask_coworker retry of the same message", async () => {
    for (const [capability, earlier, later] of [
      [
        "post_chat",
        {
          roomId: "room-1",
          content: "Draft 1",
          resultReferences: [{ id: "bad" }],
        },
        { roomId: "room-1", content: "Draft 1" },
      ],
      [
        "open_direct_chat",
        {
          person: "Hannah",
          message: "Please review the brief",
          resultReferences: [{ id: "bad" }],
        },
        { person: "@hannah", message: "Please review the brief" },
      ],
      [
        "ask_coworker",
        {
          coworkerIds: ["mira", "codepat"],
          question: "Can you check the release notes?",
          projectId: "bad-project",
        },
        {
          coworkerIds: ["codepat", "mira"],
          question: "Can you check the release notes?",
        },
      ],
    ] as const) {
      refusedThenCreated(
        { capability, input: earlier },
        { capability, targetId: `ok-${capability}`, input: later },
      );
      const response = await buildActionResponse(
        prisma,
        "turn-current",
        "Done.",
      );
      expect(response.unfulfilledActions).toEqual([]);
      expect(response.answerText).not.toContain("Not confirmed");
    }
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
    expect(response.answerText).toBe("Couldn't create a Task.");
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

  it("says beside the bot's words, not in them, that Core left a claim out", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([]);
    db.sokoBotTurn.findUnique.mockResolvedValue({ source: "CHAT" });
    const message = "x".repeat(8_000);
    const result = await buildActionResponse(
      prisma,
      "turn-current",
      message,
      true,
      {
        kind: "REPORT",
        message,
        question: null,
        observationToolCallIds: [],
        replyCheck: "cut",
      },
    );
    expect(result.answerText).toBe(`${message}\n\n${REPLY_CHECK_NOTES.cut}`);
    // No "list above": Cuso's owner never sees the receipt lines.
    expect(REPLY_CHECK_NOTES.cut).not.toMatch(/list|above/);
    expect(REPLY_CHECK_NOTES.unchecked).not.toMatch(/list|above/);
  });

  it("never takes the model's word that Core checked its reply", () => {
    expect(
      parseActionNarrativeText(
        '{"kind":"REPORT","message":"Done.","question":null,"observationToolCallIds":[],"replyCheck":"unchecked"}',
      ),
    ).not.toHaveProperty("replyCheck");
  });

  it("never appends a canned clarification question after confirmed work ran", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([
      receipt({ capability: "create_social_post", targetId: "post-one" }),
    ]);
    const result = await buildActionResponse(prisma, "turn-current", "", true, {
      kind: "CLARIFY",
      message: null,
      question: "DETAILS",
      observationToolCallIds: [],
    });
    expect(result.answerText).toBe("Created social post.");
    expect(result.answerText).not.toContain("additional details");
  });

  it("never falls through to raw uncut answerText or appends a canned question when replyCheck cut the message", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([]);
    db.sokoBotTurn.findUnique.mockResolvedValue({ source: "CHAT" });
    const rawJson =
      '{"kind":"CLARIFY","message":"I published every post.","question":"DETAILS","observationToolCallIds":[]}';
    const result = await buildActionResponse(
      prisma,
      "turn-current",
      rawJson,
      false,
      {
        kind: "CLARIFY",
        message: null,
        question: "DETAILS",
        observationToolCallIds: [],
        replyCheck: "cut",
      },
    );
    expect(result.answerText).toBe(REPLY_CHECK_NOTES.cut);
    expect(result.answerText).not.toContain("published every post");
    expect(result.answerText).not.toContain("additional details");
  });

  it("never leaks raw uncut answerText when Cuso saved a record and replyCheck cut the message", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([]);
    db.sokoBotTurn.findUnique.mockResolvedValue({
      source: "CHAT",
      versionId: "cmo-v25",
    });
    db.sokoBotToolCall.count.mockImplementation(
      async (args: { where: { capability: unknown } }) =>
        JSON.stringify(args.where.capability).includes("save_brand_brain")
          ? 1
          : 0,
    );
    const result = await buildActionResponse(
      prisma,
      "turn-current",
      "I updated every scheduled post for the month.",
      true,
      {
        kind: "REPORT",
        message: null,
        question: null,
        observationToolCallIds: [],
        replyCheck: "cut",
      },
    );
    expect(result.answerText).toBe(REPLY_CHECK_NOTES.cut);
    expect(result.answerText).not.toContain("updated every scheduled post");
  });

  it("returns Nothing to add on a background turn when replyCheck cut the entire message", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([]);
    db.sokoBotTurn.findUnique.mockResolvedValue({ source: "EVENT" });
    const result = await buildActionResponse(
      prisma,
      "turn-current",
      "I sent the update.",
      false,
      {
        kind: "REPORT",
        message: null,
        question: null,
        observationToolCallIds: [],
        replyCheck: "cut",
      },
    );
    expect(result.answerText).toBe("Nothing to add.");
  });
});
