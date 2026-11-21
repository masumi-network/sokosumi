import type { SokoBotTurnStatus } from "@sokosumi/database";
import { z } from "zod";
import { plainExcerpt } from "@/helpers/job-digest";
import prisma from "@/lib/db/prisma";
import { BACKGROUND_RUN_CLIENT_TURN_PREFIX } from "@/lib/soko-bot/turn-model";
import type { Cuso } from "@/services/cmo-cuso.service";

/**
 * The records Cuso keeps and the longer work he starts in chat, as the chat
 * shows them: a table, a list of contacts, a background run and a question
 * to a Coworker. `cmo-chat-work.service.ts` adds what he makes and hands on.
 */

/** A table as the chat shows it: its columns and rows as words. */
export interface CmoChatTable {
  columns: string[];
  rows: string[][];
  /** Every row the table holds, shown or not. */
  total: number;
}

export interface CmoChatPerson {
  name: string;
  /** Their role and organization, when known. */
  detail: string | null;
}

export interface CmoChatStep {
  label: string;
  state: "done" | "now" | "next";
}

/** What a record adds to a chat work item. */
export interface CmoChatRecord {
  id: string;
  kind: "table" | "contacts" | "run" | "question";
  state: "making" | "ready" | "failed" | "stopped";
  at: Date;
  title: string;
  by: string | null;
  text: string | null;
  readable: boolean;
  table: CmoChatTable | null;
  people: CmoChatPerson[];
  /** Everyone the list or lookup holds, shown or not. */
  total: number | null;
  steps: CmoChatStep[];
  /** A background run's own turn: its report in the room is this card. */
  turnId: string | null;
}

type Target = Pick<Cuso, "sokoBotId" | "projectId" | "workspaceId">;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Older records have scrolled far out of the chat's 50 messages. */
const SHOWN_DAYS = 30;
const SHOWN_CALLS = 40;
const SHOWN_RUNS = 6;
/** Rows and people a card shows before "Show all". */
const CARD_ROWS = 5;
/** Rows "Show all" opens inside the chat. */
export const CMO_CHAT_TABLE_ROWS = 200;
const EXCERPT = 280;

const MADE_TABLE = ["create_table", "export_contacts_to_table"];
const WROTE_ROWS = "write_table_rows";
const KEPT_LIST = "manage_contact_lists";
const LOOKED_UP = "search_contacts";
const ASKED = "ask_coworker";

const CALL_SELECT = {
  id: true,
  turnId: true,
  capability: true,
  createdAt: true,
  input: true,
  result: true,
  targetId: true,
} as const;

interface RecordCall {
  id: string;
  turnId: string;
  capability: string;
  createdAt: Date;
  input: unknown;
  result: unknown;
  targetId: string | null;
}

const wroteRowsSchema = z.object({ tableId: z.string() });
const foundSchema = z.object({
  total: z.number(),
  contacts: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      role: z.string().nullish(),
      organization: z.string().nullish(),
    }),
  ),
});
const askedSchema = z.object({
  roomId: z.string(),
  coworkers: z.array(z.object({ name: z.string() })).min(1),
});
const questionSchema = z.object({ question: z.string() });
const planSchema = z.object({
  steps: z.array(
    z.object({
      step: z.string(),
      status: z.enum(["pending", "in_progress", "done"]),
    }),
  ),
});

const EMPTY = {
  by: null,
  text: null,
  readable: false,
  table: null,
  people: [],
  total: null,
  steps: [],
  turnId: null,
};

function since(): Date {
  return new Date(Date.now() - SHOWN_DAYS * DAY_MS);
}

/** A cell as words: lists joined, nothing for an empty cell. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(cell).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function person(contact: {
  name: string;
  role?: string | null;
  organization?: string | null;
}): CmoChatPerson {
  const detail = [contact.role, contact.organization]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(", ");
  return { name: contact.name, detail: detail || null };
}

/** The table a call made or wrote into. */
function tableIdOf(call: RecordCall): string | null {
  if (MADE_TABLE.includes(call.capability)) return call.targetId;
  if (call.capability !== WROTE_ROWS) return null;
  return wroteRowsSchema.safeParse(call.input).data?.tableId ?? null;
}

/** One of Cuso's Project's tables, with its first `take` rows as words. */
async function loadTables(
  cuso: Target,
  tableIds: string[],
  take: number,
): Promise<Map<string, { title: string; table: CmoChatTable }>> {
  if (tableIds.length === 0) return new Map();
  const tables = await prisma.dataTable.findMany({
    where: {
      id: { in: tableIds },
      workspaceId: cuso.workspaceId,
      projectId: cuso.projectId,
      archivedAt: null,
    },
    select: {
      id: true,
      title: true,
      columns: {
        orderBy: { position: "asc" },
        select: { id: true, name: true },
      },
      rows: {
        where: { archivedAt: null },
        orderBy: { position: "asc" },
        take,
        select: { values: true },
      },
      _count: { select: { rows: { where: { archivedAt: null } } } },
    },
  });
  return new Map(
    tables.map((table) => [
      table.id,
      {
        title: table.title,
        table: {
          columns: table.columns.map((column) => column.name),
          rows: table.rows.map((row) => {
            const values =
              row.values && typeof row.values === "object"
                ? (row.values as Record<string, unknown>)
                : {};
            return table.columns.map((column) => cell(values[column.id]));
          }),
          total: table._count.rows,
        },
      },
    ]),
  );
}

function runState(status: SokoBotTurnStatus): CmoChatRecord["state"] {
  if (status === "COMPLETED") return "ready";
  if (status === "CANCELLED") return "stopped";
  return status === "FAILED" ? "failed" : "making";
}

/** A run's report as the owner reads it: without its `DONE:` marker. */
function report(answer: string | null): string | null {
  return answer?.replace(/^DONE:\s*/, "").trim() || null;
}

async function listRuns(cuso: Target): Promise<CmoChatRecord[]> {
  const runs = await prisma.sokoBotTurn.findMany({
    where: {
      sokoBotId: cuso.sokoBotId,
      parentTurnId: { not: null },
      clientTurnId: { startsWith: BACKGROUND_RUN_CLIENT_TURN_PREFIX },
      createdAt: { gte: since() },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: SHOWN_RUNS,
    select: {
      id: true,
      backgroundTitle: true,
      status: true,
      createdAt: true,
      completedAt: true,
      finalAnswer: true,
      toolCalls: {
        where: { capability: "update_plan" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { input: true },
      },
    },
  });
  return runs.map((run) => {
    const state = runState(run.status);
    const words = state === "ready" ? report(run.finalAnswer) : null;
    const plan = planSchema.safeParse(run.toolCalls[0]?.input);
    return {
      ...EMPTY,
      id: run.id,
      kind: "run",
      state,
      // A finished run is news: it shows where it ended, not where it began.
      at: (state === "making" ? null : run.completedAt) ?? run.createdAt,
      title: run.backgroundTitle ?? "Longer work",
      text: words ? plainExcerpt(words, EXCERPT) : null,
      readable: words !== null,
      steps:
        state === "making" && plan.success
          ? plan.data.steps.map(({ step, status }) => ({
              label: step,
              state:
                status === "done"
                  ? "done"
                  : status === "in_progress"
                    ? "now"
                    : "next",
            }))
          : [],
      turnId: run.id,
    };
  });
}

interface Answer {
  roomId: string;
  content: string;
  createdAt: Date;
  metadata: unknown;
  senderCoworker: { name: string } | null;
}

function isBeingWritten(message: { metadata: unknown }): boolean {
  const { metadata } = message;
  return (
    typeof metadata === "object" &&
    metadata !== null &&
    "streaming" in metadata &&
    metadata.streaming === true
  );
}

/** The Coworker's finished answers in the rooms Cuso asked in, oldest first. */
async function loadAnswers(roomIds: string[]): Promise<Answer[]> {
  if (roomIds.length === 0) return [];
  const answers = await prisma.chatRoomMessage.findMany({
    where: {
      roomId: { in: roomIds },
      deletedAt: null,
      senderCoworkerId: { not: null },
      content: { not: "" },
      createdAt: { gte: since() },
    },
    orderBy: { createdAt: "asc" },
    select: {
      roomId: true,
      content: true,
      createdAt: true,
      metadata: true,
      senderCoworker: { select: { name: true } },
    },
  });
  return answers.filter((answer) => !isBeingWritten(answer));
}

/** The first finished answer after the question was asked. */
function answerTo(call: RecordCall, answers: Answer[]): Answer | null {
  const asked = askedSchema.safeParse(call.result).data;
  return (
    answers.find(
      (answer) =>
        answer.roomId === asked?.roomId && answer.createdAt > call.createdAt,
    ) ?? null
  );
}

function recordCalls(cuso: Target, where: object): Promise<RecordCall[]> {
  return prisma.sokoBotToolCall.findMany({
    where: {
      status: "COMPLETED",
      turn: { sokoBotId: cuso.sokoBotId, createdAt: { gte: since() } },
      ...where,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: SHOWN_CALLS,
    select: CALL_SELECT,
  });
}

/**
 * The tables, contact lists, lookups, background runs and questions to a
 * Coworker that Cuso's chat turns made, newest first, each as it stands now.
 */
export async function listCmoChatRecords(
  cuso: Target,
): Promise<CmoChatRecord[]> {
  const [calls, runs] = await Promise.all([
    recordCalls(cuso, {
      capability: {
        in: [...MADE_TABLE, WROTE_ROWS, KEPT_LIST, LOOKED_UP, ASKED],
      },
    }),
    listRuns(cuso),
  ]);
  const oldestFirst = [...calls].reverse();

  // A table made and then filled shows once, where Cuso first touched it.
  const tableCall = new Map<string, RecordCall>();
  const listCall = new Map<string, RecordCall>();
  for (const call of oldestFirst) {
    const tableId = tableIdOf(call);
    if (tableId && !tableCall.has(tableId)) tableCall.set(tableId, call);
    if (
      call.capability === KEPT_LIST &&
      call.targetId &&
      !listCall.has(call.targetId)
    )
      listCall.set(call.targetId, call);
  }
  const asks = calls.filter((call) => call.capability === ASKED);
  const [tables, lists, answers] = await Promise.all([
    loadTables(cuso, [...tableCall.keys()], CARD_ROWS),
    listCall.size
      ? prisma.contactList.findMany({
          where: {
            id: { in: [...listCall.keys()] },
            workspaceId: cuso.workspaceId,
          },
          select: {
            id: true,
            name: true,
            members: {
              orderBy: { addedAt: "asc" },
              take: CARD_ROWS,
              select: {
                contact: {
                  select: { name: true, role: true, organization: true },
                },
              },
            },
            _count: { select: { members: true } },
          },
        })
      : [],
    loadAnswers(
      asks.flatMap(
        (call) => askedSchema.safeParse(call.result).data?.roomId ?? [],
      ),
    ),
  ]);

  const records: CmoChatRecord[] = [...runs];
  for (const [tableId, call] of tableCall) {
    const found = tables.get(tableId);
    if (!found) continue;
    records.push({
      ...EMPTY,
      id: call.id,
      kind: "table",
      state: "ready",
      at: call.createdAt,
      title: found.title,
      table: found.table,
      readable: found.table.total > found.table.rows.length,
    });
  }
  for (const list of lists) {
    const call = listCall.get(list.id);
    if (!call) continue;
    records.push({
      ...EMPTY,
      id: call.id,
      kind: "contacts",
      state: "ready",
      at: call.createdAt,
      title: list.name,
      people: list.members.map(({ contact }) => person(contact)),
      total: list._count.members,
    });
  }
  // A turn that only looked people up shows who it found, once per turn;
  // a turn that kept a list shows the list instead.
  const listTurns = new Set(
    calls
      .filter((call) => call.capability === KEPT_LIST)
      .map((call) => call.turnId),
  );
  const lookups = new Map<string, RecordCall[]>();
  for (const call of oldestFirst) {
    if (call.capability !== LOOKED_UP || listTurns.has(call.turnId)) continue;
    lookups.set(call.turnId, [...(lookups.get(call.turnId) ?? []), call]);
  }
  for (const [, searches] of lookups) {
    const found = new Map<string, CmoChatPerson>();
    let total = 0;
    for (const search of searches) {
      const result = foundSchema.safeParse(search.result);
      if (!result.success) continue;
      total = Math.max(total, result.data.total);
      for (const contact of result.data.contacts)
        found.set(contact.id, person(contact));
    }
    const first = searches[0];
    if (!first || found.size === 0) continue;
    records.push({
      ...EMPTY,
      id: first.id,
      kind: "contacts",
      state: "ready",
      at: first.createdAt,
      title: "Contacts",
      people: [...found.values()].slice(0, CARD_ROWS),
      total: Math.max(total, found.size),
    });
  }
  for (const call of asks) {
    const asked = askedSchema.safeParse(call.result).data;
    if (!asked) continue;
    const answer = answerTo(call, answers);
    const question = questionSchema.safeParse(call.input).data?.question;
    records.push({
      ...EMPTY,
      id: call.id,
      kind: "question",
      state: answer ? "ready" : "making",
      at: call.createdAt,
      title: question ?? "A question",
      by:
        answer?.senderCoworker?.name ??
        asked.coworkers.map(({ name }) => name).join(", "),
      text: answer ? plainExcerpt(answer.content, EXCERPT) : null,
      readable: answer !== null && answer.content.length > EXCERPT,
    });
  }
  return records.sort((a, b) => b.at.getTime() - a.at.getTime());
}

/** The full words of a run's report or a Coworker's answer; null otherwise. */
export async function readCmoChatRecordText(
  cuso: Target,
  id: string,
): Promise<string | null> {
  const run = await prisma.sokoBotTurn.findFirst({
    where: {
      id,
      sokoBotId: cuso.sokoBotId,
      parentTurnId: { not: null },
      status: "COMPLETED",
    },
    select: { finalAnswer: true },
  });
  if (run) return report(run.finalAnswer);
  const [call] = await recordCalls(cuso, { id, capability: ASKED });
  if (!call) return null;
  const asked = askedSchema.safeParse(call.result).data;
  const answers = asked ? await loadAnswers([asked.roomId]) : [];
  return answerTo(call, answers)?.content.trim() || null;
}

/** A table Cuso made or wrote into, in full, for "Show all" in the chat. */
export async function readCmoChatTable(
  cuso: Target,
  id: string,
): Promise<{ title: string; table: CmoChatTable } | null> {
  const [call] = await recordCalls(cuso, {
    id,
    capability: { in: [...MADE_TABLE, WROTE_ROWS] },
  });
  const tableId = call ? tableIdOf(call) : null;
  if (!tableId) return null;
  const tables = await loadTables(cuso, [tableId], CMO_CHAT_TABLE_ROWS);
  return tables.get(tableId) ?? null;
}
