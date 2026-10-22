import type { TaskX402PaymentRefundKind } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import {
  mapTransactionHistoryRow,
  type TransactionHistoryRow,
} from "./transaction-history";

function sokoBotRow(
  overrides: Partial<TransactionHistoryRow> = {},
): TransactionHistoryRow {
  return {
    id: "tx-1",
    consumedAt: new Date("2026-10-01T08:00:00Z"),
    amount: -250n,
    kind: "sokoBot",
    userId: "user-1",
    projectId: null,
    jobId: null,
    jobName: null,
    agentId: null,
    imageJobId: null,
    imageModel: null,
    imagePrompt: null,
    taskId: null,
    taskName: null,
    taskArchived: null,
    taskEventId: null,
    taskEventComment: null,
    coworkerId: null,
    coworkerName: null,
    sokoBotId: "01960001-0001-7001-8001-000000000099",
    sokoBotName: "Joseph",
    sokoBotTurnSource: "CHAT",
    sokoBotScheduleName: null,
    sokoBotScheduleKey: null,
    bucketSource: null,
    topUpSource: null,
    topUpNote: null,
    refundedJobId: null,
    refundedJobName: null,
    refundedAgentId: null,
    refundedJobOnChainStatus: null,
    refundedTaskId: null,
    refundedTaskName: null,
    refundedTaskArchived: null,
    refundSource: null,
    refundX402Kind: null,
    ...overrides,
  };
}

function map(row: TransactionHistoryRow) {
  return mapTransactionHistoryRow(row, { agentPreviewById: new Map() });
}

describe("mapTransactionHistoryRow Soko Bot rows", () => {
  it("names the bot and what the turn was for", () => {
    expect(map(sokoBotRow())).toMatchObject({
      kind: "sokoBot",
      title: "Soko Bot · Joseph",
      description: "Chat",
    });
  });

  it("labels built-in rhythms and owner schedules", () => {
    expect(
      map(
        sokoBotRow({
          sokoBotTurnSource: "SCHEDULE",
          sokoBotScheduleKey: "meeting-prep",
          sokoBotScheduleName: "Meeting prep",
        }),
      ).description,
    ).toBe("Meeting prep");
    expect(
      map(
        sokoBotRow({
          sokoBotTurnSource: "SCHEDULE",
          sokoBotScheduleName: "Monday marketplace check-in",
        }),
      ).description,
    ).toBe("Scheduled: Monday marketplace check-in");
    expect(map(sokoBotRow({ sokoBotTurnSource: "INGEST" })).description).toBe(
      "Inbox and calendar check",
    );
  });

  it("falls back cleanly for an unnamed bot with no turn", () => {
    expect(
      map(sokoBotRow({ sokoBotName: null, sokoBotTurnSource: null })),
    ).toMatchObject({ title: "Soko Bot · Unnamed", description: null });
  });
});

function refundRow(
  overrides: Partial<TransactionHistoryRow> = {},
): TransactionHistoryRow {
  return sokoBotRow({
    kind: "topUp",
    amount: 250n,
    sokoBotId: null,
    sokoBotName: null,
    sokoBotTurnSource: null,
    topUpSource: "REFUND",
    ...overrides,
  });
}

function jobRefundRow(
  overrides: Partial<TransactionHistoryRow> = {},
): TransactionHistoryRow {
  return refundRow({
    refundSource: "job",
    refundedJobId: "job-1",
    refundedJobName: "Audit the contract",
    refundedAgentId: "agent-1",
    refundedJobOnChainStatus: "REFUND_WITHDRAWN",
    ...overrides,
  });
}

function taskRefundRow(
  overrides: Partial<TransactionHistoryRow> = {},
): TransactionHistoryRow {
  return refundRow({
    refundSource: "taskPaymentClaim",
    refundedTaskId: "task-1",
    refundedTaskName: "Draft the launch email",
    ...overrides,
  });
}

describe("mapTransactionHistoryRow refund rows", () => {
  it("says why a job was refunded and links to it", () => {
    expect(map(jobRefundRow())).toMatchObject({
      kind: "topUp",
      title: "Refund",
      description: "Refund approved · Audit the contract",
      refundedJobId: "job-1",
      refundedAgentId: "agent-1",
      refundedTaskId: null,
    });
  });

  it("calls any other job outcome a payment that could not be completed", () => {
    for (const status of ["FUNDS_OR_DATUM_INVALID", null] as const) {
      expect(
        map(jobRefundRow({ refundedJobOnChainStatus: status })).description,
      ).toBe("Payment could not be completed · Audit the contract");
    }
  });

  it("never shows a payment claim's raw failure", () => {
    expect(map(taskRefundRow())).toMatchObject({
      description: "Payment could not be completed · Draft the launch email",
      refundedTaskId: "task-1",
      refundedJobId: null,
      refundedAgentId: null,
    });
  });

  it("names an archived task's refund but does not link to it", () => {
    expect(map(taskRefundRow({ refundedTaskArchived: true }))).toMatchObject({
      description: "Payment could not be completed · Draft the launch email",
      refundedTaskId: null,
    });
  });

  it("explains each x402 refund kind", () => {
    const describeKind = (refundX402Kind: TaskX402PaymentRefundKind | null) =>
      map(taskRefundRow({ refundSource: "taskX402", refundX402Kind }))
        .description;

    expect(describeKind("NODE_REFUSAL")).toBe(
      "Payment was refused · Draft the launch email",
    );
    expect(describeKind("OPERATOR_GOODWILL")).toBe(
      "Refunded by support · Draft the launch email",
    );
    expect(describeKind("OPERATOR_RESOLVE")).toBe(
      "Refunded by support · Draft the launch email",
    );
    expect(describeKind(null)).toBe("Draft the launch email");
  });

  it("keeps the refund description when a top up note is also set", () => {
    expect(map(jobRefundRow({ topUpNote: "Manual adjustment" }))).toMatchObject(
      {
        description: "Refund approved · Audit the contract",
        refundedJobId: "job-1",
      },
    );
  });

  it("uses a top up note when the refund has no linked job or task", () => {
    expect(map(refundRow({ topUpNote: "Manual adjustment" })).description).toBe(
      "Manual adjustment",
    );
  });

  it("truncates a long name and keeps the reason", () => {
    const description = map(
      jobRefundRow({ refundedJobName: "x".repeat(300) }),
    ).description;

    expect(description).toBe(`Refund approved · ${"x".repeat(119)}…`);
  });

  it("keeps the reason when the refunded job has no name", () => {
    expect(map(jobRefundRow({ refundedJobName: null }))).toMatchObject({
      description: "Refund approved",
      refundedJobId: "job-1",
    });
  });

  it("leaves a refund with no job or task, and other top ups, unexplained", () => {
    expect(map(refundRow())).toMatchObject({
      description: null,
      refundedJobId: null,
      refundedAgentId: null,
      refundedTaskId: null,
    });
    expect(map(refundRow({ topUpSource: "STRIPE_TOPUP" }))).toMatchObject({
      title: "Credit top up",
      description: null,
    });
  });
});
