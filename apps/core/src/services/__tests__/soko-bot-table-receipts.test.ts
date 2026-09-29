import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { AuthorizedSokoBotRuntime } from "@/services/soko-bot-runtime.service";

const mocks = vi.hoisted(() => ({
  receipt: vi.fn(),
  updateReceipt: vi.fn(),
  reclaim: vi.fn(),
  workspace: vi.fn(),
  turn: vi.fn(),
  actor: vi.fn(),
  create: vi.fn(),
  batch: vi.fn(),
  list: vi.fn(),
  mutate: vi.fn(),
  recover: vi.fn(),
  alias: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotToolCall: {
      findUnique: mocks.receipt,
      update: mocks.updateReceipt,
      updateMany: mocks.reclaim,
      upsert: mocks.alias,
    },
    workspace: { findUniqueOrThrow: mocks.workspace },
    sokoBotTurn: { findUnique: mocks.turn },
  },
}));
vi.mock("@/helpers/data-table", () => ({
  resolveTableActor: mocks.actor,
  readTableOperation: mocks.recover,
  createDataTable: mocks.create,
  batchTableRows: mocks.batch,
  listDataTables: mocks.list,
  requireDataTable: vi.fn(),
  queryTableRows: vi.fn(),
  mutateDataTable: mocks.mutate,
}));

import { SokoBotRuntimeService } from "@/services/soko-bot-runtime.service";

const userId = randomUUID();
const workspaceId = randomUUID();
const sokoBotId = randomUUID();
const turnId = randomUUID();
const sessionId = "tables-test";
const authorized: AuthorizedSokoBotRuntime = {
  turn: {
    id: turnId,
    userId,
    workspaceId,
    sokoBotId,
    eveSessionId: sessionId,
    versionId: null,
    source: "CHAT",
    chainDepth: 0,
  },
  classificationConfidence: 1,
  grant: {
    userId,
    workspaceId,
    sokoBotId,
    issuer: "test",
    audience: "test",
    subject: sokoBotId,
    jwtId: randomUUID(),
    sessionId,
    turnId,
    contextSnapshotId: randomUUID(),
    memoryRevisionId: null,
    memoryVersion: 0,
    capabilities: ["create_table", "write_table_rows"],
    issuedAt: 0,
    expiresAt: 9999999999,
  },
};
const actor = { userId, workspaceId, actorId: sokoBotId, actorKind: "sokoBot" };

it.each(["write_table_rows", "create_table", "update_table_columns"] as const)(
  "F9: executeTool rehydrates %s after receipt truncation",
  async (capability) => {
    vi.resetAllMocks();
    const runtime = new SokoBotRuntimeService();
    vi.spyOn(runtime, "authorize").mockResolvedValue(authorized);
    mocks.workspace.mockResolvedValue({
      id: workspaceId,
      organizationId: null,
    });
    mocks.actor.mockResolvedValue(actor);
    const tableId = randomUUID();
    const columns = Array.from({ length: 100 }, (_, i) => ({
      id: randomUUID(),
      name: `Column ${i}`,
      description: "d".repeat(200),
      type: "text",
    }));
    const payloads = {
      write_table_rows: {
        tableId,
        key: randomUUID(),
        insert: [{ values: { [randomUUID()]: "x".repeat(20000) } }],
      },
      create_table: { key: randomUUID(), title: "Research", columns },
      update_table_columns: { tableId, key: randomUUID(), version: 1, columns },
    };
    const input = payloads[capability];
    const { actionInputHash } = await import("@/lib/soko-bot/action-receipts");
    let receipt = {
      id: randomUUID(),
      turnId,
      toolCallId: "original-call",
      status: "COMPLETED",
      targetId: tableId,
      capability,
      inputHash: actionInputHash(input),
      result: { truncated: true },
    };
    mocks.receipt.mockImplementation(async () => receipt);
    mocks.reclaim.mockResolvedValue({ count: 1 });
    mocks.updateReceipt.mockImplementation(async ({ data }) => {
      receipt = { ...receipt, ...data };
      return receipt;
    });
    const result =
      capability === "write_table_rows"
        ? {
            batchId: randomUUID(),
            rows: [
              {
                id: randomUUID(),
                version: 1,
                values: payloads.write_table_rows.insert[0].values,
              },
            ],
          }
        : { id: tableId, title: "Research", version: 2, columns };
    const helper =
      capability === "write_table_rows"
        ? mocks.batch
        : capability === "create_table"
          ? mocks.create
          : mocks.mutate;
    helper.mockResolvedValue(result);
    mocks.turn.mockResolvedValue({ chatMention: null });
    const request = {
      turnId,
      sessionId,
      toolCallId: "same-call",
      capability,
      input,
    };
    mocks.recover.mockResolvedValue({ tableId, result });
    const replay = await runtime.executeTool(request);
    expect(replay).toEqual(
      capability === "create_table"
        ? {
            table: result,
            url: `/drive/tables/${tableId}`,
            instruction:
              "Table created. Present this link now; enrich in bounded batches. Reuse this table ID for follow-ups.",
          }
        : result,
    );
    expect(helper).not.toHaveBeenCalled();
    expect(mocks.recover).toHaveBeenCalledOnce();
    expect(mocks.alias).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          turnId,
          toolCallId: "same-call",
          replayedReceiptId: receipt.id,
          disposition: "ALREADY_SATISFIED",
        }),
      }),
    );
    expect(receipt.result).toMatchObject({ truncated: true });
  },
);
