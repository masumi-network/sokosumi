import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { AuthorizedSokoBotRuntime } from "@/services/soko-bot-runtime.service";

const mocks = vi.hoisted(() => ({
  receipt: vi.fn(),
  updateReceipt: vi.fn(),
  reclaim: vi.fn(),
  workspace: vi.fn(),
  turn: vi.fn(),
  message: vi.fn(),
  taskEvent: vi.fn(),
  actor: vi.fn(),
  create: vi.fn(),
  batch: vi.fn(),
  list: vi.fn(),
  mutate: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotToolCall: {
      findUnique: mocks.receipt,
      update: mocks.updateReceipt,
      updateMany: mocks.reclaim,
    },
    workspace: { findUniqueOrThrow: mocks.workspace },
    sokoBotTurn: { findUnique: mocks.turn },
    chatRoomMessage: { findFirst: mocks.message },
    taskEvent: { findFirst: mocks.taskEvent },
  },
}));
vi.mock("@/helpers/data-table", () => ({
  resolveTableActor: mocks.actor,
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
    const { createHash } = await import("node:crypto");
    let receipt = {
      id: randomUUID(),
      status: "PENDING",
      capability,
      inputHash: createHash("sha256")
        .update(JSON.stringify(input))
        .digest("hex"),
      result: null,
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
    const first = await runtime.executeTool(request);
    expect(first).toMatchObject(
      capability === "create_table"
        ? { table: result, url: `/drive/tables/${tableId}` }
        : result,
    );
    const replay = await runtime.executeTool(request);
    expect(replay).toEqual(first);
    expect(helper).toHaveBeenCalledTimes(2);
    expect(helper.mock.calls[0]).toEqual(helper.mock.calls[1]);
    expect(receipt.result).toMatchObject({ truncated: true });
  },
);
