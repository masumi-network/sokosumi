import type { SokoBotToolCall } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createNetworkScope } from "@/lib/db/network-scope";
import prisma from "@/lib/db/prisma";
import { buildActionResponse as buildScopedActionResponse } from "./action-response";

const db = vi.hoisted(() => ({
  sokoBotToolCall: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
  sokoBotTurn: { findUnique: vi.fn() },
  task: { findFirst: vi.fn(), findMany: vi.fn() },
  job: { findMany: vi.fn() },
}));
const scope = createNetworkScope("mainnet");
const buildActionResponse = buildScopedActionResponse.bind(null, scope);
vi.mock("@/lib/db/prisma", () => ({ default: db, networkPrisma: () => db }));

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

  const seoProjectId = "01a0f400-0000-7000-8000-000000000001";
  const seoTargetId = "01a0f400-0000-7000-8000-000000000002";
  const seoTaskId = "01a0f400-0000-7000-8000-000000000003";
  const seoLink = `/seo?projectId=${seoProjectId}&view=project`;
  const seoLabels = {
    add_seo_page: "Added SEO page",
    save_seo_scope: "Saved SEO page group",
    save_seo_keyword: "Saved SEO keyword",
    save_seo_competitor: "Saved SEO competitor",
    import_seo_audit: "Imported SEO audit",
    request_seo_analysis: "Requested SEO analysis",
    create_seo_action_task: "Created SEO action task",
    sync_seo_statistics: "Synced SEO statistics",
    record_seo_page_change: "Recorded SEO page change",
  };

  it.each(Object.entries(seoLabels))(
    "renders %s from its committed SEO receipt without model action claims",
    async (capability, label) => {
      db.sokoBotToolCall.findMany.mockResolvedValueOnce([
        receipt({
          capability,
          targetId: seoTargetId,
          input: { projectId: "model-project", link: "https://evil.example" },
          result: { projectId: seoProjectId, id: seoTargetId, link: seoLink },
        }),
      ]);
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
      expect(result.answerText).toBe(`${label} ([Open SEO](${seoLink})).`);
      expect(result.answerText).not.toContain("model-project");
    },
  );

  it.each(["create_seo_action_task", "request_seo_analysis"])(
    "links %s to the returned Task, scoped to its project and turn workspace",
    async (capability) => {
      db.sokoBotToolCall.findMany.mockResolvedValueOnce([
        receipt({
          capability,
          targetId: seoTargetId,
          result: {
            projectId: seoProjectId,
            id: seoTargetId,
            taskId: seoTaskId,
            link: seoLink,
          },
        }),
      ]);
      db.sokoBotTurn.findUnique.mockResolvedValue({
        workspaceId: "workspace-one",
      });
      db.task.findMany.mockResolvedValueOnce([
        { id: seoTaskId, projectId: seoProjectId, name: "Fix [launch] title" },
      ]);
      const result = await buildActionResponse(prisma, "turn-current", "");
      expect(db.task.findMany).toHaveBeenCalledWith({
        where: {
          workspaceId: "workspace-one",
          visibility: "PUBLIC",
          OR: [{ id: seoTaskId, projectId: seoProjectId }],
        },
        select: { id: true, name: true, projectId: true },
      });
      expect(result.answerText).toContain(
        `[Fix \\[launch\\] title](/tasks/${seoTaskId})`,
      );
      expect(result.answerText).not.toContain(`/tasks/${seoTargetId}`);
      expect(result.answerText).toContain(`([Open SEO](${seoLink}))`);
    },
  );

  it("does not reveal private or out-of-scope SEO Task names or invent a Task link", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([
      receipt({
        capability: "create_seo_action_task",
        targetId: seoTargetId,
        input: { taskId: "private-task", name: "Private task name" },
        result: {
          projectId: seoProjectId,
          id: seoTargetId,
          taskId: seoTaskId,
          link: seoLink,
        },
      }),
    ]);
    db.sokoBotTurn.findUnique.mockResolvedValue({
      workspaceId: "workspace-one",
    });
    db.task.findMany.mockResolvedValueOnce([]);
    const result = await buildActionResponse(prisma, "turn-current", "");
    expect(result.answerText).toBe(
      `Created SEO action task ([Open SEO](${seoLink})).`,
    );
    expect(result.answerText).not.toContain("Private task name");
    expect(result.answerText).not.toContain("/tasks/");
  });

  it("does not use a saved Task field on a non-Task SEO operation", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([
      receipt({
        capability: "save_seo_keyword",
        targetId: seoTargetId,
        result: {
          projectId: seoProjectId,
          id: seoTargetId,
          taskId: seoTaskId,
          link: seoLink,
        },
      }),
    ]);
    const result = await buildActionResponse(prisma, "turn-current", "");
    expect(result.answerText).toBe(
      `Saved SEO keyword ([Open SEO](${seoLink})).`,
    );
    expect(db.task.findMany).not.toHaveBeenCalled();
  });

  it("keeps the Task link hidden when the owning turn cannot be read", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([
      receipt({
        capability: "create_seo_action_task",
        targetId: seoTargetId,
        result: {
          projectId: seoProjectId,
          id: seoTargetId,
          taskId: seoTaskId,
          link: seoLink,
        },
      }),
    ]);
    db.sokoBotTurn.findUnique.mockResolvedValue(null);
    const result = await buildActionResponse(prisma, "turn-current", "");
    expect(result.answerText).toBe(
      `Created SEO action task ([Open SEO](${seoLink})).`,
    );
    expect(db.task.findMany).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { projectId: seoProjectId, id: "different-target", link: seoLink },
    { projectId: seoProjectId, id: seoTargetId, link: "https://evil.example" },
    {
      projectId: seoProjectId,
      id: seoTargetId,
      link: `${seoLink}&next=https://evil.example`,
    },
    {
      projectId: "../private",
      id: seoTargetId,
      link: "/seo?projectId=../private&view=project",
    },
  ])("keeps malformed and legacy SEO results label-only: %j", async (saved) => {
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([
      receipt({
        capability: "add_seo_page",
        targetId: seoTargetId,
        input: { projectId: seoProjectId, link: seoLink },
        result: saved,
      }),
    ]);
    const result = await buildActionResponse(prisma, "turn-current", "");
    expect(result.answerText).toBe("Added SEO page.");
    expect(db.task.findMany).not.toHaveBeenCalled();
  });
});
