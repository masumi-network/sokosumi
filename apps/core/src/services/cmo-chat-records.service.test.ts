import { beforeEach, describe, expect, it, vi } from "vitest";

const { db } = vi.hoisted(() => ({
  db: {
    sokoBotToolCall: { findMany: vi.fn() },
    sokoBotTurn: { findMany: vi.fn(), findFirst: vi.fn() },
    dataTable: { findMany: vi.fn() },
    contactList: { findMany: vi.fn() },
    chatRoomMessage: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/db/prisma", () => ({ default: db }));

import {
  listCmoChatRecords,
  readCmoChatRecordText,
  readCmoChatTable,
} from "./cmo-chat-records.service";

const cuso = {
  sokoBotId: "bot-1",
  projectId: "project-1",
  workspaceId: "ws-1",
};
const at = (minute: number) =>
  new Date(`2026-11-18T12:${String(minute).padStart(2, "0")}:00Z`);

function call(
  id: string,
  capability: string,
  minute: number,
  extra: {
    turnId?: string;
    input?: unknown;
    result?: unknown;
    targetId?: string;
  } = {},
) {
  return {
    id,
    turnId: extra.turnId ?? `turn-${id}`,
    capability,
    createdAt: at(minute),
    input: extra.input ?? null,
    result: extra.result ?? null,
    targetId: extra.targetId ?? null,
  };
}

/** Core reads calls newest first. */
const calls = (...made: ReturnType<typeof call>[]) =>
  db.sokoBotToolCall.findMany.mockResolvedValue(
    [...made].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
  );

const tracker = {
  id: "table-1",
  title: "Content tracker",
  columns: [
    { id: "c-post", name: "Post" },
    { id: "c-tags", name: "Tags" },
  ],
  rows: [
    { values: { "c-post": "Launch post", "c-tags": ["x", "launch"] } },
    { values: { "c-post": "Second post" } },
  ],
  _count: { rows: 12 },
};

beforeEach(() => {
  vi.useFakeTimers({ now: at(59) });
  vi.clearAllMocks();
  db.sokoBotToolCall.findMany.mockResolvedValue([]);
  db.sokoBotTurn.findMany.mockResolvedValue([]);
  db.sokoBotTurn.findFirst.mockResolvedValue(null);
  db.dataTable.findMany.mockResolvedValue([]);
  db.contactList.findMany.mockResolvedValue([]);
  db.chatRoomMessage.findMany.mockResolvedValue([]);
});

describe("tables", () => {
  it("shows a table once, where Cuso made it, with its rows as words", async () => {
    calls(
      call("made", "create_table", 1, { targetId: "table-1" }),
      call("filled", "write_table_rows", 2, {
        input: { tableId: "table-1", insert: [] },
      }),
    );
    db.dataTable.findMany.mockResolvedValue([tracker]);

    await expect(listCmoChatRecords(cuso)).resolves.toMatchObject([
      {
        id: "made",
        kind: "table",
        state: "ready",
        at: at(1),
        title: "Content tracker",
        readable: true,
        table: {
          columns: ["Post", "Tags"],
          rows: [
            ["Launch post", "x, launch"],
            ["Second post", ""],
          ],
          total: 12,
        },
      },
    ]);
  });

  it("reads only tables of Cuso's own Project and organization", async () => {
    calls(call("made", "export_contacts_to_table", 1, { targetId: "table-9" }));

    await expect(listCmoChatRecords(cuso)).resolves.toEqual([]);
    expect(db.dataTable.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: ["table-9"] },
          workspaceId: "ws-1",
          projectId: "project-1",
          archivedAt: null,
        },
      }),
    );
    expect(db.sokoBotToolCall.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "COMPLETED",
          turn: expect.objectContaining({ sokoBotId: "bot-1" }),
        }),
      }),
    );
  });

  it("opens a whole table by the call that made it", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValue([
      call("made", "create_table", 1, { targetId: "table-1" }),
    ]);
    db.dataTable.findMany.mockResolvedValue([tracker]);

    await expect(readCmoChatTable(cuso, "made")).resolves.toMatchObject({
      title: "Content tracker",
      table: { total: 12 },
    });
    expect(db.dataTable.findMany.mock.calls[0]?.[0].select.rows.take).toBe(200);

    db.sokoBotToolCall.findMany.mockResolvedValue([]);
    await expect(readCmoChatTable(cuso, "someone-else")).resolves.toBeNull();
  });
});

describe("contacts", () => {
  it("shows a list Cuso keeps, with who is on it", async () => {
    calls(
      call("search", "search_contacts", 1, {
        turnId: "turn-1",
        result: { total: 1, contacts: [{ id: "c1", name: "Mira" }] },
      }),
      call("create", "manage_contact_lists", 2, {
        turnId: "turn-1",
        targetId: "list-1",
      }),
      call("add", "manage_contact_lists", 3, {
        turnId: "turn-1",
        targetId: "list-1",
      }),
    );
    db.contactList.findMany.mockResolvedValue([
      {
        id: "list-1",
        name: "Press",
        members: [
          {
            contact: {
              name: "Mira Lindqvist",
              role: "Editor",
              organization: "Product Weekly",
            },
          },
          { contact: { name: "Jonas Feld", role: null, organization: null } },
        ],
        _count: { members: 5 },
      },
    ]);

    // The turn kept a list, so its lookups are not a card of their own.
    await expect(listCmoChatRecords(cuso)).resolves.toMatchObject([
      {
        id: "create",
        kind: "contacts",
        title: "Press",
        people: [
          { name: "Mira Lindqvist", detail: "Editor, Product Weekly" },
          { name: "Jonas Feld", detail: null },
        ],
        total: 5,
      },
    ]);
    expect(db.contactList.findMany.mock.calls[0]?.[0].where).toEqual({
      id: { in: ["list-1"] },
      workspaceId: "ws-1",
    });
  });

  it("shows who a turn looked up, once per turn", async () => {
    const found = (id: string, name: string) => ({
      total: 1,
      contacts: [{ id, name, role: null, organization: "Acme" }],
    });
    calls(
      call("a", "search_contacts", 1, {
        turnId: "turn-1",
        result: found("c1", "Mira"),
      }),
      call("b", "search_contacts", 2, {
        turnId: "turn-1",
        result: found("c2", "Jonas"),
      }),
      call("c", "search_contacts", 3, {
        turnId: "turn-1",
        result: found("c1", "Mira"),
      }),
      call("none", "search_contacts", 4, {
        turnId: "turn-2",
        result: { total: 0, contacts: [] },
      }),
    );

    await expect(listCmoChatRecords(cuso)).resolves.toMatchObject([
      {
        id: "a",
        kind: "contacts",
        title: "Contacts",
        people: [
          { name: "Mira", detail: "Acme" },
          { name: "Jonas", detail: "Acme" },
        ],
        total: 2,
      },
    ]);
  });
});

describe("background runs", () => {
  const run = (status: string, extra: object = {}) => ({
    id: "run-1",
    backgroundTitle: "Results log",
    status,
    createdAt: at(5),
    completedAt: null,
    finalAnswer: null,
    toolCalls: [],
    ...extra,
  });

  it("shows a running run with its plan, where it started", async () => {
    db.sokoBotTurn.findMany.mockResolvedValue([
      run("RUNNING", {
        toolCalls: [
          {
            input: {
              steps: [
                { step: "Read the posts", status: "done" },
                { step: "Fill the table", status: "in_progress" },
                { step: "Write it up", status: "pending" },
              ],
            },
          },
        ],
      }),
    ]);

    await expect(listCmoChatRecords(cuso)).resolves.toMatchObject([
      {
        id: "run-1",
        kind: "run",
        state: "making",
        at: at(5),
        title: "Results log",
        text: null,
        steps: [
          { label: "Read the posts", state: "done" },
          { label: "Fill the table", state: "now" },
          { label: "Write it up", state: "next" },
        ],
        turnId: "run-1",
      },
    ]);
    expect(db.sokoBotTurn.findMany.mock.calls[0]?.[0].where).toMatchObject({
      sokoBotId: "bot-1",
      parentTurnId: { not: null },
      clientTurnId: { startsWith: "background:" },
    });
  });

  it("shows a finished run with its result, where it ended", async () => {
    db.sokoBotTurn.findMany.mockResolvedValue([
      run("COMPLETED", {
        completedAt: at(40),
        finalAnswer: "DONE: Four weeks are in the table.",
      }),
    ]);

    await expect(listCmoChatRecords(cuso)).resolves.toMatchObject([
      {
        state: "ready",
        at: at(40),
        text: "Four weeks are in the table.",
        readable: true,
        steps: [],
      },
    ]);
  });

  it.each(["DONE: Nothing to add.", "Nothing to add.", null])(
    "leaves out a finished run that reported %s",
    async (finalAnswer) => {
      db.sokoBotTurn.findMany.mockResolvedValue([
        run("COMPLETED", { completedAt: at(40), finalAnswer }),
      ]);

      await expect(listCmoChatRecords(cuso)).resolves.toEqual([]);
    },
  );

  it.each([
    ["CANCELLED", "stopped"],
    ["FAILED", "failed"],
    ["CANCEL_REQUESTED", "making"],
  ])("shows a %s run as %s", async (status, state) => {
    db.sokoBotTurn.findMany.mockResolvedValue([run(status)]);

    const [record] = await listCmoChatRecords(cuso);
    expect(record).toMatchObject({ state, text: null, readable: false });
  });

  it("reads a finished run's whole report, only for this Cuso", async () => {
    db.sokoBotTurn.findFirst.mockResolvedValue({
      finalAnswer: "DONE: All of it.",
    });

    await expect(readCmoChatRecordText(cuso, "run-1")).resolves.toBe(
      "All of it.",
    );
    expect(db.sokoBotTurn.findFirst.mock.calls[0]?.[0].where).toMatchObject({
      id: "run-1",
      sokoBotId: "bot-1",
      status: "COMPLETED",
    });
  });
});

describe("questions to a Coworker", () => {
  const asked = call("ask", "ask_coworker", 10, {
    input: { coworkerIds: ["hannah"], question: "How long would it take?" },
    result: { roomId: "room-ask", coworkers: [{ name: "Hannah" }] },
  });
  const reply = (minute: number, content: string, metadata: unknown = {}) => ({
    roomId: "room-ask",
    content,
    createdAt: at(minute),
    metadata,
    senderCoworker: { name: "Hannah" },
  });

  it("waits for the answer, then signs it with the Coworker's name", async () => {
    calls(asked);

    await expect(listCmoChatRecords(cuso)).resolves.toMatchObject([
      {
        id: "ask",
        kind: "question",
        state: "making",
        title: "How long would it take?",
        by: "Hannah",
        text: null,
      },
    ]);

    db.chatRoomMessage.findMany.mockResolvedValue([
      reply(9, "An older answer, before this question."),
      reply(11, "About two", { streaming: true }),
      reply(12, "About two hours."),
    ]);
    await expect(listCmoChatRecords(cuso)).resolves.toMatchObject([
      { state: "ready", by: "Hannah", text: "About two hours." },
    ]);
    expect(db.chatRoomMessage.findMany.mock.calls[0]?.[0].where).toMatchObject({
      roomId: { in: ["room-ask"] },
      senderCoworkerId: { not: null },
      content: { not: "" },
    });
  });

  it("reads the Coworker's whole answer", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValue([asked]);
    db.chatRoomMessage.findMany.mockResolvedValue([
      reply(12, "About two hours, and I need your competitors."),
    ]);

    await expect(readCmoChatRecordText(cuso, "ask")).resolves.toBe(
      "About two hours, and I need your competitors.",
    );
  });
});
