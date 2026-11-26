import type { Prisma } from "@sokosumi/database";
import {
  redactSokoBotSensitiveText,
  sokoBotReadContextInputSchema,
} from "@sokosumi/soko-bot";
import { SETTLED_TASK_STATUSES } from "@/helpers/task-settled-statuses";
import prisma from "@/lib/db/prisma";
import { contextPacketScope } from "@/lib/soko-bot/context-packet-scope";
import {
  SOKO_BOT_JOB_STATUS_SELECT,
  sokoBotJobStatus,
} from "@/lib/soko-bot/job-status";
import {
  type AuthorizedSokoBotRuntime,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";

/**
 * `read_context` (v38, ADR 0086): what a small packet's map counts but does
 * not show, read with the packet's own filters, so a read never shows what
 * the packet could not. Pages run newest first on (time, id), and `next`
 * always starts right after the last item returned, so no item is skipped or
 * shown twice.
 */

const DEFAULT_LIMIT = 10;
const MESSAGE_CHARS = 500;
const SELF_STARTED_MESSAGE_CHARS = 80;
const ANSWER_CHARS = 1_200;
const SUMMARY_CHARS = 500;
/** Under the stored tool-result cap (16 KiB), so a page is never cut later. */
const PAGE_BYTES = 12_000;

const queryWords = (query: string | undefined): string[] => {
  const words = (query ?? "").split(/\s+/).filter(Boolean);
  // Short words are noise beside longer ones, but a query of only short
  // words ("X") still narrows the read instead of returning everything.
  const long = words.filter((word) => word.length >= 2);
  return long.length ? long : words;
};

/** Up to `max` characters, around the first query word when there is one. */
function excerpt(
  value: string | null,
  max: number,
  words: readonly string[],
): string | null {
  if (!value) return null;
  const text = redactSokoBotSensitiveText(value).replaceAll(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const lower = text.toLowerCase();
  const hits = words
    .map((word) => lower.indexOf(word.toLowerCase()))
    .filter((index) => index >= 0);
  const hit = hits.length ? Math.min(...hits) : 0;
  const start = Math.min(
    Math.max(0, hit - Math.floor(max / 4)),
    text.length - max,
  );
  return `${start > 0 ? "…" : ""}${text.slice(start, start + max)}…`;
}

const contains = (value: string) => ({
  contains: value,
  mode: "insensitive" as const,
});

/** Every word of the query in one of the fields: one phrase rarely matches. */
function wordsIn<T>(
  words: readonly string[],
  fields: (word: ReturnType<typeof contains>) => T[],
): { OR: T[] }[] {
  return words.map((word) => ({ OR: fields(contains(word)) }));
}

interface Cursor {
  at: Date;
  id: string;
}

function parseCursor(cursor: string | undefined): Cursor | null {
  if (!cursor) return null;
  const [at, id] = cursor.split("|");
  const date = at ? new Date(at) : null;
  if (!date || Number.isNaN(date.getTime()) || !id)
    throw new SokoBotRuntimeValidationError(
      "read_context's cursor is the `next` a previous read returned.",
    );
  return { at: date, id };
}

/** Rows after the cursor in (field desc, id desc) order. */
function after(field: string, cursor: Cursor | null) {
  if (!cursor) return {};
  return {
    OR: [
      { [field]: { lt: cursor.at } },
      { [field]: cursor.at, id: { lt: cursor.id } },
    ],
  };
}

/**
 * The rows that fit the page, and the cursor after the last one when more
 * remain (rows beyond the limit, or rows the byte budget left out).
 */
function page<Row, Item>(
  rows: readonly Row[],
  limit: number,
  toItem: (row: Row) => Item,
  key: (row: Row) => Cursor,
): { items: Item[]; next?: string } {
  const items: Item[] = [];
  let bytes = 0;
  let last: Row | undefined;
  for (const row of rows.slice(0, limit)) {
    const item = toItem(row);
    const size = Buffer.byteLength(JSON.stringify(item), "utf8");
    if (items.length > 0 && bytes + size > PAGE_BYTES) break;
    items.push(item);
    bytes += size;
    last = row;
  }
  const more = rows.length > items.length;
  if (!more || !last) return { items };
  const { at, id } = key(last);
  return { items, next: `${at.toISOString()}|${id}` };
}

/** The packet's filters for this turn, rebuilt the way the control plane built them. */
async function turnScope(authorized: AuthorizedSokoBotRuntime) {
  const turn = await prisma.sokoBotTurn.findUniqueOrThrow({
    where: { id: authorized.turn.id },
    select: {
      source: true,
      askedByUserId: true,
      destinationRoomId: true,
      chatMention: { select: { message: { select: { roomId: true } } } },
    },
  });
  const { reader } = authorized;
  const teammate = reader.audience !== undefined && reader.audience !== "OWNER";
  return contextPacketScope({
    userId: reader.userId,
    sokoBotId: authorized.turn.sokoBotId,
    workspaceId: authorized.turn.workspaceId,
    audience: teammate ? "TEAMMATE" : "OWNER",
    askedByKind: authorized.askedByKind ?? "OWNER",
    askedByUserId: turn.askedByUserId,
    roomId:
      turn.chatMention?.message.roomId ??
      (teammate ? turn.destinationRoomId : null),
    sharedScope: reader.sharedScope,
    source: turn.source,
  });
}

export async function readContext(
  authorized: AuthorizedSokoBotRuntime,
  raw: unknown,
): Promise<unknown> {
  const parsed = sokoBotReadContextInputSchema.safeParse(raw);
  if (!parsed.success)
    throw new SokoBotRuntimeValidationError(
      "read_context needs section (conversation, projects or jobs), and optionally query, cursor (the `next` of a previous read) and limit (1-25).",
    );
  const input = parsed.data;
  const limit = input.limit ?? DEFAULT_LIMIT;
  const cursor = parseCursor(input.cursor);
  const words = queryWords(input.query);
  const scope = await turnScope(authorized);

  if (input.section === "conversation") {
    const rows = await prisma.sokoBotTurn.findMany({
      where: {
        AND: [
          scope.recentTurnWhere,
          { id: { not: authorized.turn.id } },
          after("createdAt", cursor),
          ...wordsIn<Prisma.SokoBotTurnWhereInput>(words, (word) => [
            { userMessage: word },
            { finalAnswer: word },
          ]),
        ],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: {
        id: true,
        source: true,
        userMessage: true,
        finalAnswer: true,
        createdAt: true,
      },
    });
    const { items, next } = page(
      rows,
      limit,
      (turn) => ({
        id: turn.id,
        at: turn.createdAt.toISOString(),
        source: turn.source,
        message: excerpt(
          turn.userMessage,
          turn.source === "CHAT" ? MESSAGE_CHARS : SELF_STARTED_MESSAGE_CHARS,
          words,
        ),
        answer: excerpt(turn.finalAnswer, ANSWER_CHARS, words),
      }),
      (turn) => ({ at: turn.createdAt, id: turn.id }),
    );
    return { turns: items, ...(next ? { next } : {}) };
  }

  if (input.section === "projects") {
    const rows = await prisma.project.findMany({
      where: {
        AND: [
          scope.projectWhere,
          after("updatedAt", cursor),
          ...wordsIn<Prisma.ProjectWhereInput>(words, (word) => [
            { name: word },
            { briefing: word },
          ]),
        ],
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: {
        id: true,
        name: true,
        briefing: true,
        updatedAt: true,
        _count: {
          select: {
            tasks: {
              where: {
                archivedAt: null,
                status: { notIn: [...SETTLED_TASK_STATUSES] },
                ...scope.taskWhere,
              },
            },
          },
        },
      },
    });
    const { items, next } = page(
      rows,
      limit,
      (project) => ({
        id: project.id,
        name: excerpt(project.name, 160, words),
        summary: excerpt(project.briefing, SUMMARY_CHARS, words),
        openTasks: project._count.tasks,
        updatedAt: project.updatedAt.toISOString(),
      }),
      (project) => ({ at: project.updatedAt, id: project.id }),
    );
    return { projects: items, ...(next ? { next } : {}) };
  }

  const rows = await prisma.job.findMany({
    where: {
      AND: [
        { ...scope.jobWhere, workspaceId: authorized.turn.workspaceId },
        after("updatedAt", cursor),
        ...wordsIn<Prisma.JobWhereInput>(words, (word) => [{ name: word }]),
      ],
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: {
      ...SOKO_BOT_JOB_STATUS_SELECT,
      id: true,
      name: true,
      updatedAt: true,
    },
  });
  const { items, next } = page(
    rows,
    limit,
    (job) => ({
      id: job.id,
      name: excerpt(job.name, 160, words),
      // The status Core shows everywhere, as in the packet.
      status: sokoBotJobStatus(job).status,
      projectId: job.projectId,
      updatedAt: job.updatedAt.toISOString(),
    }),
    (job) => ({ at: job.updatedAt, id: job.id }),
  );
  return { jobs: items, ...(next ? { next } : {}) };
}
