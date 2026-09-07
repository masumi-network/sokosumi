import { TaskStatus } from "@sokosumi/database";
import { SokosumiJobStatus } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import type { HistoryItem } from "@/schemas/history.schema";

import {
  compareNeedsAttention,
  jobNeedsAttentionTier,
  rankNeedsAttentionItems,
  taskNeedsAttentionTier,
} from "./project-needs-attention";

function task(
  overrides: Partial<HistoryItem> & {
    status: TaskStatus;
    updatedAt?: string;
    id?: string;
  },
): HistoryItem {
  const { status, id, updatedAt, ...rest } = overrides;
  return {
    kind: "task",
    id: id ?? "task-default",
    title: "Task",
    description: null,
    status,
    updatedAt: updatedAt ?? "2026-09-01T00:00:00.000Z",
    archivedAt: null,
    credits: null,
    projectId: "project-1",
    coworkerId: null,
    sokoBotId: null,
    owner: null,
    ...rest,
  };
}

function job(
  overrides: Partial<HistoryItem> & {
    status: SokosumiJobStatus;
    updatedAt?: string;
    id?: string;
  },
): HistoryItem {
  const { status, id, updatedAt, ...rest } = overrides;
  return {
    kind: "job",
    id: id ?? "job-default",
    title: "Job",
    description: null,
    status,
    updatedAt: updatedAt ?? "2026-09-01T00:00:00.000Z",
    archivedAt: null,
    credits: null,
    projectId: "project-1",
    agentId: "agent-1",
    agentName: null,
    agentIcon: null,
    owner: null,
    ...rest,
  };
}

describe("taskNeedsAttentionTier", () => {
  it("classifies must-act task statuses as tier 0", () => {
    expect(taskNeedsAttentionTier(TaskStatus.INPUT_REQUIRED)).toBe(0);
    expect(taskNeedsAttentionTier(TaskStatus.GRANT_PENDING)).toBe(0);
  });

  it("excludes completed and draft tasks", () => {
    expect(taskNeedsAttentionTier(TaskStatus.COMPLETED)).toBeNull();
    expect(taskNeedsAttentionTier(TaskStatus.DRAFT)).toBeNull();
  });
});

describe("jobNeedsAttentionTier", () => {
  it("classifies payment_failed as must-act tier 0", () => {
    expect(jobNeedsAttentionTier(SokosumiJobStatus.PAYMENT_FAILED)).toBe(0);
  });

  it("classifies failed and dispute_pending as tier 1", () => {
    expect(jobNeedsAttentionTier(SokosumiJobStatus.FAILED)).toBe(1);
    expect(jobNeedsAttentionTier(SokosumiJobStatus.DISPUTE_PENDING)).toBe(1);
  });

  it("excludes completed and refund statuses", () => {
    expect(jobNeedsAttentionTier(SokosumiJobStatus.COMPLETED)).toBeNull();
    expect(jobNeedsAttentionTier(SokosumiJobStatus.REFUND_RESOLVED)).toBeNull();
  });
});

describe("compareNeedsAttention", () => {
  it("orders lower tiers first", () => {
    expect(
      compareNeedsAttention(
        { id: "a", kind: "task", tier: 0, updatedAtMs: 0 },
        { id: "b", kind: "job", tier: 2, updatedAtMs: 9_999 },
      ),
    ).toBeLessThan(0);
  });

  it("orders newer items first within the same tier", () => {
    expect(
      compareNeedsAttention(
        { id: "a", kind: "task", tier: 2, updatedAtMs: 200 },
        { id: "b", kind: "task", tier: 2, updatedAtMs: 100 },
      ),
    ).toBeLessThan(0);
  });
});

describe("rankNeedsAttentionItems", () => {
  it("returns at most 5 mixed rows, must-act before failed before in-flight, then updatedAt desc", () => {
    const items = rankNeedsAttentionItems([
      task({
        id: "task-running",
        status: TaskStatus.RUNNING,
        updatedAt: "2026-09-01T00:00:00.000Z",
      }),
      job({
        id: "job-input",
        status: SokosumiJobStatus.INPUT_REQUIRED,
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
      task({
        id: "task-failed",
        status: TaskStatus.FAILED,
        updatedAt: "2026-08-01T00:00:00.000Z",
      }),
      job({
        id: "job-completed",
        status: SokosumiJobStatus.COMPLETED,
        updatedAt: "2026-09-02T00:00:00.000Z",
      }),
    ]);

    expect(items.map((item) => item.id)).toEqual([
      "job-input",
      "task-failed",
      "task-running",
    ]);
  });

  it("does not pad with completed, canceled, draft, ready, or settled jobs", () => {
    const items = rankNeedsAttentionItems([
      task({ id: "task-completed", status: TaskStatus.COMPLETED }),
      job({ id: "job-completed", status: SokosumiJobStatus.COMPLETED }),
      task({ id: "task-draft", status: TaskStatus.DRAFT }),
      task({ id: "task-ready", status: TaskStatus.READY }),
    ]);

    expect(items).toEqual([]);
  });

  it("caps results at five items", () => {
    const items = rankNeedsAttentionItems(
      Array.from({ length: 8 }, (_, index) =>
        task({
          id: `task-${index}`,
          status: TaskStatus.RUNNING,
          updatedAt: `2026-09-0${index + 1}T00:00:00.000Z`,
        }),
      ),
    );

    expect(items).toHaveLength(5);
  });

  it("ranks older must-act above newer in-flight", () => {
    const items = rankNeedsAttentionItems([
      task({
        id: "task-running-new",
        status: TaskStatus.RUNNING,
        updatedAt: "2026-09-07T00:00:00.000Z",
      }),
      job({
        id: "job-payment-failed-old",
        status: SokosumiJobStatus.PAYMENT_FAILED,
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    ]);

    expect(items.map((item) => item.id)).toEqual([
      "job-payment-failed-old",
      "task-running-new",
    ]);
  });
});
