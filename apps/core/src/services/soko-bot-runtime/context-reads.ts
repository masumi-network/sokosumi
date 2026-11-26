import type { Prisma } from "@sokosumi/database";
import {
  redactSokoBotSensitiveText,
  sokoBotReadContextInputSchema,
} from "@sokosumi/soko-bot";
import { SETTLED_TASK_STATUSES } from "@/helpers/task-settled-statuses";
import prisma from "@/lib/db/prisma";
import { contextPacketScope } from "@/lib/soko-bot/context-packet-scope";
import {
  type AuthorizedSokoBotRuntime,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";

/**
 * `read_context` (v38, ADR 0086): what a small packet's map counts but does
 * not show, read with the packet's own filters, so a read never shows what
 * the packet could not.
 */

const DEFAULT_LIMIT = 10;
const MESSAGE_CHARS = 500;
const SELF_STARTED_MESSAGE_CHARS = 80;
const ANSWER_CHARS = 1_200;
const SUMMARY_CHARS = 500;

function clean(value: string | null, max: number): string | null {
  if (!value) return null;
  return redactSokoBotSensitiveText(value)
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const contains = (value: string) => ({
  contains: value,
  mode: "insensitive" as const,
});

/** Every word of the query in one of the fields: one phrase rarely matches. */
function wordsIn<T>(
  query: string | undefined,
  fields: (word: ReturnType<typeof contains>) => T[],
): { OR: T[] }[] {
  const words = (query ?? "").split(/\s+/).filter(Boolean);
  // Short words are noise beside longer ones, but a query of only short
  // words ("X") still narrows the read instead of returning everything.
  const long = words.filter((word) => word.length >= 2);
  return (long.length ? long : words).map((word) => ({
    OR: fields(contains(word)),
  }));
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
      "read_context needs section (conversation, projects or jobs), and optionally query, before (an ISO time) and limit (1-25).",
    );
  const input = parsed.data;
  const limit = input.limit ?? DEFAULT_LIMIT;
  const before = input.before ? new Date(input.before) : null;
  const scope = await turnScope(authorized);

  if (input.section === "conversation") {
    const rows = await prisma.sokoBotTurn.findMany({
      where: {
        AND: [
          scope.recentTurnWhere,
          { id: { not: authorized.turn.id } },
          before ? { createdAt: { lt: before } } : {},
          ...wordsIn<Prisma.SokoBotTurnWhereInput>(input.query, (word) => [
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
    const turns = rows.slice(0, limit);
    return {
      turns: turns.map((turn) => ({
        id: turn.id,
        at: turn.createdAt.toISOString(),
        source: turn.source,
        message: clean(
          turn.userMessage,
          turn.source === "CHAT" ? MESSAGE_CHARS : SELF_STARTED_MESSAGE_CHARS,
        ),
        answer: clean(turn.finalAnswer, ANSWER_CHARS),
      })),
      ...(rows.length > limit
        ? { olderBefore: turns.at(-1)?.createdAt.toISOString() }
        : {}),
    };
  }

  if (input.section === "projects") {
    const rows = await prisma.project.findMany({
      where: {
        AND: [
          scope.projectWhere,
          ...wordsIn<Prisma.ProjectWhereInput>(input.query, (word) => [
            { name: word },
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
    return {
      projects: rows.slice(0, limit).map((project) => ({
        id: project.id,
        name: clean(project.name, 160),
        summary: clean(project.briefing, SUMMARY_CHARS),
        openTasks: project._count.tasks,
        updatedAt: project.updatedAt.toISOString(),
      })),
      more: rows.length > limit,
    };
  }

  const rows = await prisma.job.findMany({
    where: {
      AND: [
        { ...scope.jobWhere, workspaceId: authorized.turn.workspaceId },
        before ? { updatedAt: { lt: before } } : {},
        ...wordsIn<Prisma.JobWhereInput>(input.query, (word) => [
          { name: word },
        ]),
      ],
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: {
      id: true,
      name: true,
      projectId: true,
      updatedAt: true,
      events: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { status: true },
      },
    },
  });
  const jobs = rows.slice(0, limit);
  return {
    jobs: jobs.map((job) => ({
      id: job.id,
      name: clean(job.name, 160),
      status: job.events[0]?.status ?? null,
      projectId: job.projectId,
      updatedAt: job.updatedAt.toISOString(),
    })),
    ...(rows.length > limit
      ? { olderBefore: jobs.at(-1)?.updatedAt.toISOString() }
      : {}),
  };
}
