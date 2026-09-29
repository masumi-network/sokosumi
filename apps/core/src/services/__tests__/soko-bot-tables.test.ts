import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthorizedSokoBotRuntime } from "../soko-bot-runtime.service";

const mocks = vi.hoisted(() => ({
  workspace: vi.fn(),
  turn: vi.fn(),
  actor: vi.fn(),
  create: vi.fn(),
  batch: vi.fn(),
  list: vi.fn(),
  child: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotToolCall: {
      upsert: mocks.child,
      update: mocks.update,
      count: vi.fn().mockResolvedValue(1),
    },
    workspace: { findUniqueOrThrow: mocks.workspace },
    sokoBotTurn: { findUnique: mocks.turn },
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

import prisma from "@/lib/db/prisma";
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
    capabilities: [
      "create_table",
      "write_table_rows",
      "post_chat",
      "reply_to_task",
    ],
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
    mocks.child.mockImplementation(async ({ create }) => ({
      id: randomUUID(),
      ...create,
    }));
    mocks.update.mockImplementation(async ({ data }) => ({
      id: randomUUID(),
      capability: "create_table",
      ...data,
    }));
    mocks.turn.mockResolvedValue({
      chatMention: { message: { roomId: "room-test" } },
    });
  });
  function service() {
    const service = new SokoBotRuntimeService();
    vi.spyOn(service, "authorize").mockResolvedValue(authorized);
    service["requireMutationAuthority"] = vi
      .fn()
      .mockResolvedValue({ id: workspaceId, organizationId: null });
    return service;
  }
  it("stages the live table link through the existing receipt-backed chat path", async () => {
    const runtime = service();
    const post = vi.fn<SokoBotRuntimeService["postChat"]>().mockResolvedValue({
      messageId: "message",
      roomId: "room-test",
      queuedAt: new Date().toISOString(),
      queuedMentions: 0,
      deliveryStatus: "QUEUED",
    });
    runtime["postChat"] = post;
    const table = { id: randomUUID(), title: "Company research" };
    mocks.create.mockImplementation(async (_actor, _input, complete) => {
      await complete(prisma, {
        tableId: table.id,
        result: {
          ...table,
          workspaceId,
          projectId: null,
          description: "",
          createdBy: sokoBotId,
          version: 1,
          archivedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          columns: [],
          views: [],
        },
        replayed: false,
      });
      return table;
    });
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
      expect.any(Function),
    );
    expect(post).toHaveBeenCalledWith(
      authorized,
      {
        roomId: "room-test",
        content: `[Company research](/drive/tables/${table.id})`,
        toolCallId: "create:table-link:chat",
        publicationId: expect.any(String),
      },
      prisma,
    );
    expect(result).toMatchObject({ table, url: `/drive/tables/${table.id}` });
  });
  it("reuses the operation key and publication identity across tool receipts", async () => {
    const runtime = service();
    const post = vi.fn<SokoBotRuntimeService["postChat"]>().mockResolvedValue({
      messageId: "message",
      roomId: "room-test",
      queuedAt: new Date().toISOString(),
      queuedMentions: 0,
      deliveryStatus: "QUEUED",
    });
    runtime["postChat"] = post;
    const table = { id: randomUUID(), title: "Research" };
    mocks.create.mockImplementation(async (_actor, _input, complete) => {
      await complete(prisma, {
        tableId: table.id,
        result: {
          ...table,
          workspaceId,
          projectId: null,
          description: "",
          createdBy: sokoBotId,
          version: 1,
          archivedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          columns: [],
          views: [],
        },
        replayed: false,
      });
      return table;
    });
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
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0][1].publicationId).toEqual(
      post.mock.calls[1][1].publicationId,
    );
  });
  it.each(["grant", "stored permission", "child collision"])(
    "rejects unsafe link publication: %s",
    async (failure) => {
      const runtime = service();
      const tableId = randomUUID();
      const body = {
        key: randomUUID(),
        title: "Scoped table",
        columns: [{ name: "Name", type: "text" }],
      };
      if (failure === "grant")
        vi.mocked(runtime.authorize).mockResolvedValue({
          ...authorized,
          grant: { ...authorized.grant, capabilities: ["create_table"] },
        });
      if (failure === "stored permission")
        runtime["requireMutationAuthority"] = vi
          .fn()
          .mockImplementation(async (_tx, _auth, _approved, capability) => {
            if (capability === "post_chat")
              throw new Error("Post permission revoked");
            return { id: workspaceId, organizationId: null };
          });
      if (failure === "child collision")
        mocks.child.mockResolvedValue({
          id: randomUUID(),
          capability: "archive_task",
          inputHash: "different",
          status: "COMPLETED",
        });
      const post = vi.fn<SokoBotRuntimeService["postChat"]>();
      runtime["postChat"] = post;
      mocks.create.mockImplementation(async (_actor, _input, complete) => {
        await complete(prisma, {
          tableId,
          result: {
            id: tableId,
            title: "Scoped table",
            workspaceId,
            projectId: null,
            description: "",
            createdBy: sokoBotId,
            version: 1,
            archivedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            columns: [],
            views: [],
          },
          replayed: false,
        });
      });
      await expect(
        runtime["executeAuthorizedTool"]({
          sessionId,
          turnId,
          toolCallId: "create",
          capability: "create_table",
          input: body,
        }),
      ).rejects.toThrow();
      expect(post).not.toHaveBeenCalled();
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );

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
      expect.any(Function),
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
  it("passes a stable publication identity when retrying a task-created table", async () => {
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
        eventId: randomUUID(),
        statusChanged: false,
      });
    runtime["replyToTask"] = reply;
    mocks.turn.mockResolvedValue({ chatMention: null });
    const table = { id: randomUUID(), title: "Task research" };
    mocks.create.mockImplementation(async (_actor, _input, complete) => {
      await complete(prisma, {
        tableId: table.id,
        result: {
          ...table,
          workspaceId,
          projectId: null,
          description: "",
          createdBy: sokoBotId,
          version: 1,
          archivedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          columns: [],
          views: [],
        },
        replayed: false,
      });
      return table;
    });
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
      expect.any(Function),
    );
    expect(reply).toHaveBeenCalledTimes(2);
    expect(reply.mock.calls[0][3]).toEqual(reply.mock.calls[1][3]);
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        turn: expect.objectContaining({ source: "EVENT" }),
      }),
      {
        taskId: body.taskId,
        comment: `[Open table](/drive/tables/${table.id})`,
      },
      "task-create-0:table-link:task",
      { transaction: prisma, publicationId: expect.any(String) },
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
