import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthorizedSokoBotRuntime } from "../soko-bot-runtime.service";

const mocks = vi.hoisted(() => ({
  workspace: vi.fn(),
  turn: vi.fn(),
  message: vi.fn(),
  taskEvent: vi.fn(),
  actor: vi.fn(),
  create: vi.fn(),
  batch: vi.fn(),
  list: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
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
  mutateDataTable: vi.fn(),
}));

import { SokoBotRuntimeService } from "../soko-bot-runtime.service";

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
describe("Soko Bot table dispatch", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.workspace.mockResolvedValue({
      id: workspaceId,
      organizationId: null,
    });
    mocks.actor.mockResolvedValue(actor);
    mocks.turn.mockResolvedValue({
      chatMention: { message: { roomId: "room-test" } },
    });
    mocks.message.mockResolvedValue(null);
  });
  function service() {
    const service = new SokoBotRuntimeService();
    vi.spyOn(service, "authorize").mockResolvedValue(authorized);
    return service;
  }
  it("publishes the live table link immediately through the existing chat path", async () => {
    const runtime = service();
    const post = vi.fn<SokoBotRuntimeService["postChat"]>().mockResolvedValue({
      messageId: "message",
      roomId: "room-test",
      postedAt: new Date().toISOString(),
      summoned: 0,
    });
    runtime["postChat"] = post;
    const table = { id: randomUUID(), title: "Company research" };
    mocks.create.mockResolvedValue(table);
    const body = {
      key: randomUUID(),
      title: table.title,
      columns: [
        {
          id: randomUUID(),
          name: "Company",
          type: "text",
          description: "Company name",
        },
      ],
    };
    const result = await runtime["executeAuthorizedTool"]({
      sessionId,
      turnId,
      toolCallId: "create",
      capability: "create_table",
      input: body,
    });
    expect(mocks.actor).toHaveBeenCalledWith(
      expect.objectContaining({ userId, sokoBotId, workspaceId }),
      workspaceId,
    );
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining(actor),
      expect.objectContaining({ key: body.key, title: body.title }),
    );
    expect(post).toHaveBeenCalledWith(authorized, {
      roomId: "room-test",
      content: `[Company research](/drive/tables/${table.id})`,
    });
    expect(result).toMatchObject({ table, url: `/drive/tables/${table.id}` });
  });
  it("reuses the table operation key and avoids republishing an acknowledged link", async () => {
    const runtime = service();
    const post = vi.fn<SokoBotRuntimeService["postChat"]>().mockResolvedValue({
      messageId: "message",
      roomId: "room-test",
      postedAt: new Date().toISOString(),
      summoned: 0,
    });
    runtime["postChat"] = post;
    const table = { id: randomUUID(), title: "Research" };
    mocks.create.mockResolvedValue(table);
    mocks.message.mockResolvedValue({ id: "existing" });
    const body = {
      key: randomUUID(),
      title: table.title,
      columns: [{ id: randomUUID(), name: "Company", type: "text" }],
    };
    for (let retry = 0; retry < 2; retry++)
      await runtime["executeAuthorizedTool"]({
        sessionId,
        turnId,
        toolCallId: `retry-${retry}`,
        capability: "create_table",
        input: body,
      });
    expect(mocks.create.mock.calls.map((call) => call[1].key)).toEqual([
      body.key,
      body.key,
    ]);
    expect(post).not.toHaveBeenCalled();
  });
  it("passes task scope and selected cell versions to durable writes", async () => {
    const runtime = service();
    const tableId = randomUUID();
    const rowId = randomUUID();
    const columnId = randomUUID();
    const taskId = "assigned-task";
    const body = {
      tableId,
      taskId,
      key: randomUUID(),
      patch: [
        {
          id: rowId,
          version: 7,
          values: { [columnId]: 42 },
          evidence: { [columnId]: [{ url: "https://example.com/pricing" }] },
        },
      ],
    };
    await runtime["executeAuthorizedTool"]({
      sessionId,
      turnId,
      toolCallId: "write",
      capability: "write_table_rows",
      input: body,
    });
    expect(mocks.batch).toHaveBeenCalledWith(
      { ...actor, taskId, ownerChat: true },
      tableId,
      expect.objectContaining({ key: body.key, patch: body.patch }),
    );
  });
  it("rejects unattended creation without assigned task context", async () => {
    const runtime = service();
    vi.mocked(runtime.authorize).mockResolvedValue({
      ...authorized,
      turn: { ...authorized.turn, source: "EVENT" },
    });
    await expect(
      runtime["executeAuthorizedTool"]({
        sessionId,
        turnId,
        toolCallId: "create",
        capability: "create_table",
        input: {
          key: randomUUID(),
          title: "Outside task",
          columns: [{ name: "Name", type: "text" }],
        },
      }),
    ).rejects.toThrow("assigned taskId");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("publishes a task-created table immediately and avoids a duplicate task link on retry", async () => {
    const runtime = service();
    vi.mocked(runtime.authorize).mockResolvedValue({
      ...authorized,
      turn: { ...authorized.turn, source: "EVENT" },
    });
    const reply = vi
      .fn<SokoBotRuntimeService["replyToTask"]>()
      .mockResolvedValue({
        id: "assigned-task",
        name: "Research",
        status: "RUNNING",
        commented: true,
      });
    runtime["replyToTask"] = reply;
    mocks.turn.mockResolvedValue({ chatMention: null });
    mocks.taskEvent
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ id: "event" });
    const table = { id: randomUUID(), title: "Task research" };
    mocks.create.mockResolvedValue(table);
    const body = {
      key: randomUUID(),
      taskId: "assigned-task",
      title: table.title,
      columns: [{ name: "Company", type: "text" }],
    };
    for (let retry = 0; retry < 2; retry++)
      await runtime["executeAuthorizedTool"]({
        sessionId,
        turnId,
        toolCallId: `task-create-${retry}`,
        capability: "create_table",
        input: body,
      });
    expect(mocks.create).toHaveBeenCalledWith(
      { ...actor, taskId: body.taskId, ownerChat: false },
      expect.objectContaining({ key: body.key }),
    );
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        turn: expect.objectContaining({ source: "EVENT" }),
      }),
      {
        taskId: body.taskId,
        comment: `[Open table](/drive/tables/${table.id})`,
      },
      "task-create-0:table-link",
    );
  });
  it.each(["list_tables", "read_table"] as const)(
    "requires task context for unattended %s",
    async (capability) => {
      const runtime = service();
      vi.mocked(runtime.authorize).mockResolvedValue({
        ...authorized,
        turn: { ...authorized.turn, source: "EVENT" },
      });
      await expect(
        runtime["executeAuthorizedTool"]({
          sessionId,
          turnId,
          toolCallId: "read",
          capability,
          input: { tableId: randomUUID() },
        }),
      ).rejects.toThrow("assigned taskId");
      expect(mocks.list).not.toHaveBeenCalled();
    },
  );
});
