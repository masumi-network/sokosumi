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
