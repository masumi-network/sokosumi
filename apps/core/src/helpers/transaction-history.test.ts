import { describe, expect, it, vi } from "vitest";

import {
  buildTransactionHistoryWhere,
  getTransactionHistory,
  mapTransactionRow,
  resolveTransactionSource,
  type TransactionRowForHistory,
} from "@/helpers/transaction-history";
import type { WorkspaceContext } from "@/middleware/workspace";

function createRow(
  overrides: Partial<TransactionRowForHistory> = {},
): TransactionRowForHistory {
  return {
    id: "txn_123",
    createdAt: new Date("2026-01-15T10:30:00.000Z"),
    updatedAt: new Date("2026-01-15T10:30:00.000Z"),
    amount: -50_000_000_000n,
    userId: "user_123",
    organizationId: null,
    job: null,
    refundedJob: null,
    taskPaymentClaim: null,
    coworkerUsage: null,
    orchestratorUsage: null,
    sourceCreditBucket: null,
    ...overrides,
  } as TransactionRowForHistory;
}

describe("buildTransactionHistoryWhere", () => {
  it("scopes to the organization when the workspace is an org workspace", () => {
    const workspaceContext: WorkspaceContext = {
      workspaceId: "ws_1",
      userId: null,
      organizationId: "org_1",
    };

    expect(buildTransactionHistoryWhere(workspaceContext)).toEqual({
      organizationId: "org_1",
    });
  });

  it("scopes to the owning user with no organization for a personal workspace", () => {
    const workspaceContext: WorkspaceContext = {
      workspaceId: "ws_1",
      userId: "user_1",
      organizationId: null,
    };

    expect(buildTransactionHistoryWhere(workspaceContext)).toEqual({
      userId: "user_1",
      organizationId: null,
    });
  });

  it("fails closed instead of scoping to every personal workspace when userId is missing", () => {
    const workspaceContext: WorkspaceContext = {
      workspaceId: "ws_1",
      userId: null,
      organizationId: null,
    };

    expect(() => buildTransactionHistoryWhere(workspaceContext)).toThrow();
  });
});

describe("resolveTransactionSource", () => {
  it.each([
    ["refundedJob", { refundedJob: { id: "job_1" } }, "job_refund"],
    ["job", { job: { id: "job_1" } }, "job_purchase"],
    ["taskPaymentClaim", { taskPaymentClaim: { id: "claim_1" } }, "task_usage"],
    ["coworkerUsage", { coworkerUsage: { id: "usage_1" } }, "coworker_usage"],
    [
      "orchestratorUsage",
      { orchestratorUsage: { id: "usage_1" } },
      "orchestrator_usage",
    ],
    [
      "sourceCreditBucket",
      { sourceCreditBucket: { id: "bucket_1" } },
      "credit_grant",
    ],
    ["none", {}, "other"],
  ] as const)("maps %s to %s", (_label, overrides, expected) => {
    expect(resolveTransactionSource(createRow(overrides as never))).toBe(
      expected,
    );
  });

  it("prefers refundedJob over job when both happen to be present", () => {
    const row = createRow({
      job: { id: "job_1" } as never,
      refundedJob: { id: "job_2" } as never,
    });

    expect(resolveTransactionSource(row)).toBe("job_refund");
  });
});

describe("mapTransactionRow", () => {
  it("converts cents to signed credits and carries the job and agent id", () => {
    const row = createRow({
      amount: -50_000_000_000n,
      job: { id: "job_1", agentId: "agent_1" } as never,
    });

    expect(mapTransactionRow(row)).toEqual({
      id: "txn_123",
      createdAt: "2026-01-15T10:30:00.000Z",
      credits: -5,
      source: "job_purchase",
      jobId: "job_1",
      agentId: "agent_1",
    });
  });

  it("reads the job id and agent id from refundedJob for a refund", () => {
    const row = createRow({
      amount: 50_000_000_000n,
      refundedJob: { id: "job_1", agentId: "agent_1" } as never,
    });

    expect(mapTransactionRow(row)).toMatchObject({
      jobId: "job_1",
      agentId: "agent_1",
    });
  });

  it("has a null jobId and agentId when no job relation is populated", () => {
    const item = mapTransactionRow(createRow());
    expect(item.jobId).toBeNull();
    expect(item.agentId).toBeNull();
  });
});

describe("getTransactionHistory", () => {
  it("overfetches by one to compute hasMore and trims the extra row", async () => {
    const rows = [createRow({ id: "txn_1" }), createRow({ id: "txn_2" })];
    const findMany = vi.fn().mockResolvedValue(rows);
    const count = vi.fn().mockResolvedValue(2);
    const tx = { transaction: { findMany, count } };

    const workspaceContext: WorkspaceContext = {
      workspaceId: "ws_1",
      userId: "user_1",
      organizationId: null,
    };

    const result = await getTransactionHistory(
      workspaceContext,
      { take: 1 },
      tx,
    );

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user_1", organizationId: null },
        take: 2,
      }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.hasMore).toBe(true);
    expect(result.count).toBe(2);
  });
});
