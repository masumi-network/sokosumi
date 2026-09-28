import { describe, expect, it, vi } from "vitest";

import type { TransactionHistoryRow } from "@/helpers/transaction-history";

import {
  csvField,
  csvLabel,
  streamTransactionCsv,
} from "./transaction-history-csv";

const CREDIT = 10_000_000_000n;

function row(
  id: string,
  amount: bigint,
  overrides: Partial<TransactionHistoryRow> = {},
): TransactionHistoryRow {
  return {
    id,
    consumedAt: new Date("2026-09-15T10:30:00.000Z"),
    amount,
    kind: "task",
    userId: null,
    projectId: null,
    jobId: null,
    jobName: null,
    agentId: null,
    imageJobId: null,
    imageModel: null,
    imagePrompt: null,
    taskId: "task_1",
    taskName: "Plain task",
    taskEventId: "evt_1",
    taskEventComment: null,
    coworkerId: null,
    coworkerName: null,
    sokoBotId: null,
    bucketSource: null,
    topUpSource: null,
    topUpNote: null,
    ...overrides,
  };
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

const params = {
  scope: "owned" as const,
  userContext: {
    actor: "user",
    userId: "u",
    organizationId: null,
    role: "user",
  },
  workspaceContext: { workspaceId: "w", userId: "u", organizationId: null },
} as unknown as Parameters<typeof streamTransactionCsv>[0];

describe("csvField", () => {
  it("quotes a field with a separator, a quote or a line break", () => {
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("one\ntwo")).toBe('"one\ntwo"');
    expect(csvField("plain")).toBe("plain");
  });

  it("defuses a label a spreadsheet would run as a formula", () => {
    expect(csvLabel("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(csvLabel("@cmd")).toBe("'@cmd");
    expect(csvLabel("Plain")).toBe("Plain");
  });
});

describe("streamTransactionCsv", () => {
  it("writes a header, one ISO-dated row per transaction and totals", async () => {
    const queryRaw = vi.fn().mockResolvedValueOnce([
      row("t2", -2n * CREDIT, { taskName: 'Fix, "quote"' }),
      row("t1", 5n * CREDIT, {
        kind: "topUp",
        topUpSource: "STRIPE_TOPUP",
      }),
    ]);
    const client = { $queryRaw: queryRaw, agent: { findMany: vi.fn() } };

    const csv = await readAll(streamTransactionCsv(params, client as never));

    expect(csv.split("\r\n")).toEqual([
      "date,source,label,credits",
      '2026-09-15T10:30:00.000Z,task,"Fix, ""quote""",-2',
      "2026-09-15T10:30:00.000Z,topUp,Credit top up,5",
      ",total,Spent,-2",
      ",total,Top ups,5",
      ",total,Net,3",
      "",
    ]);
  });

  it("keeps paging until the ledger runs out, then writes one set of totals", async () => {
    const full = Array.from({ length: 1001 }, (_, i) => row(`t${i}`, -CREDIT));
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce(full)
      .mockResolvedValueOnce([row("last", -CREDIT)]);
    const client = { $queryRaw: queryRaw, agent: { findMany: vi.fn() } };

    const csv = await readAll(streamTransactionCsv(params, client as never));

    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect(csv.match(/,total,Spent,-1001\r\n/)).not.toBeNull();
    expect(
      csv.split("\r\n").filter((line) => line.startsWith(",total")),
    ).toHaveLength(3);
  });
});
