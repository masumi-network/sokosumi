import type { SokoBotToolCall } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/db/prisma";
import { ACTION_CAPABILITIES } from "./action-receipts";
import { buildActionResponse } from "./action-response";

const db = vi.hoisted(() => ({
  sokoBotToolCall: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
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

describe("action lines the owner reads", () => {
  beforeEach(() => {
    vi.resetAllMocks();
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
