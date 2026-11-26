import { type Prisma } from "@sokosumi/database";
import { sokoBotListTasksInputSchema as listTasksInputSchema } from "@sokosumi/soko-bot";
import { formatTaskIdentifier, hideSeoAuditRequest } from "@sokosumi/utils";
import { DAY_MS } from "@/config/constants";
import { findSeoAuditOnlyHitIds } from "@/helpers/seo-audit-search-hits";
import {
  SOKO_BOT_OWNER_NAME_SELECT,
  sokoBotAuthorLabel,
  taskOwnerLabel,
} from "@/helpers/soko-bot-owner";
import { SETTLED_TASK_STATUSES } from "@/helpers/task-settled-statuses";
import { buildSokoBotReaderTaskWhere } from "@/helpers/task-visibility";
import prisma from "@/lib/db/prisma";
import { roundCredits, taskCreditsCharged } from "@/lib/soko-bot/task-charges";
import { readSokoBotTaskOutcome } from "@/services/soko-bot-task-outcome.service";
import { type AuthorizedSokoBotRuntime } from "../soko-bot-runtime.service";
import { type RuntimeOperations } from "./operations";

/** Sub-tasks get_task_status shows, as many as one list_tasks page. */
const SUBTASKS_READ_LIMIT = 25;

/** A `@db.Date` reads back as UTC midnight, so its ISO day is the stored day. */
export const calendarDay = (date: Date | null) =>
  date ? date.toISOString().slice(0, 10) : null;

/** The owner's board, filtered; `readTask` gives one Task in full. */
export async function listTasks(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  raw: unknown,
) {
  const input = listTasksInputSchema.parse(raw);
  const state = input.state ?? (input.parentTaskId ? "all" : "open");
  const now = Date.now();
  const finished = [...SETTLED_TASK_STATUSES];
  const contains = (value: string) => ({
    contains: value,
    mode: "insensitive" as const,
  });
  const assignee = input.assignee?.trim();
  const words = (input.query ?? "")
    .split(/\s+/)
    .filter((word) => word.length >= 2);
  // A hit inside a full audit's hidden `seo_audit` line is no hit, per word.
  const seoAuditOnlyHits = await Promise.all(
    words.map((word) => findSeoAuditOnlyHitIds(word)),
  );
  const where: Prisma.TaskWhereInput = {
    AND: [
      { workspaceId: authorized.turn.workspaceId, archivedAt: null },
      buildSokoBotReaderTaskWhere(authorized.reader),
      // An exact status is the question itself; `state` would only
      // contradict it (FAILED is finished, yet "open" is the default).
      input.status
        ? { status: { in: [input.status].flat() } }
        : state === "open"
          ? { status: { notIn: finished } }
          : state === "finished"
            ? { status: { in: finished } }
            : {},
      input.projectId ? { projectId: input.projectId } : {},
      input.parentTaskId ? { parentTaskId: input.parentTaskId } : {},
      input.idleDays
        ? {
            updatedAt: {
              lte: new Date(now - input.idleDays * DAY_MS),
            },
          }
        : {},
      // Every word, in the name or description: one phrase rarely matches.
      ...words.map((word, at) => ({
        OR: [
          { name: contains(word) },
          {
            description: contains(word),
            ...(seoAuditOnlyHits[at].length > 0
              ? { id: { notIn: seoAuditOnlyHits[at] } }
              : {}),
          },
        ],
      })),
      assignee?.toLowerCase() === "unassigned"
        ? { assigneeId: null, assigneeUserId: null, assigneeSokoBotId: null }
        : assignee
          ? {
              OR: [
                { assignee: { name: contains(assignee) } },
                { assigneeUser: { name: contains(assignee) } },
                { assigneeSokoBot: { name: contains(assignee) } },
              ],
            }
          : {},
    ],
  };
  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where,
      orderBy: input.parentTaskId
        ? [{ position: "asc" }, { id: "asc" }]
        : [{ updatedAt: "desc" }, { id: "desc" }],
      take: input.limit,
      select: {
        id: true,
        name: true,
        status: true,
        updatedAt: true,
        dueOn: true,
        number: true,
        parentTaskId: true,
        ownerId: true,
        owner: { select: { name: true } },
        assignee: { select: { name: true } },
        assigneeUser: { select: { name: true } },
        assigneeSokoBot: { select: { name: true } },
        project: { select: { id: true, name: true, identifier: true } },
        events: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
          select: { status: true, comment: true, createdAt: true },
        },
      },
    }),
    prisma.task.count({ where }),
  ]);
  // Counts past the page: "what is stuck" needs every INPUT_REQUIRED Task,
  // not the ones among the latest few that happened to be listed.
  const byStatus = await prisma.task.groupBy({
    by: ["status"],
    where,
    _count: { _all: true },
  });
  const charged = await taskCreditsCharged(tasks.map((task) => task.id));
  return {
    tasks: tasks.map((task) => {
      const latest = task.events[0];
      return {
        id: task.id,
        identifier: formatTaskIdentifier(task.project?.identifier, task.number),
        name: task.name,
        status: task.status,
        ...(task.parentTaskId ? { parentTaskId: task.parentTaskId } : {}),
        dueOn: calendarDay(task.dueOn),
        owner: taskOwnerLabel(task, authorized.turn.actingUserId),
        assignee: task.assignee
          ? { kind: "coworker", name: task.assignee.name }
          : task.assigneeUser
            ? { kind: "member", name: task.assigneeUser.name }
            : task.assigneeSokoBot
              ? { kind: "assistant", name: task.assigneeSokoBot.name }
              : null,
        project: task.project
          ? { id: task.project.id, name: task.project.name }
          : null,
        idleDays: Math.floor((now - task.updatedAt.getTime()) / DAY_MS),
        updatedAt: task.updatedAt.toISOString(),
        ...(charged.has(task.id)
          ? { creditsCharged: roundCredits(charged.get(task.id)!) }
          : {}),
        latest: latest
          ? {
              status: latest.status,
              comment: latest.comment?.slice(0, 200) ?? null,
              at: latest.createdAt.toISOString(),
            }
          : null,
      };
    }),
    total,
    byStatus: Object.fromEntries(
      byStatus.map((row) => [row.status, row._count._all]),
    ),
  };
}

export async function readTask(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  taskId: string,
) {
  const ownerId = authorized.turn.actingUserId;
  const visiblePeerTask = {
    workspaceId: authorized.turn.workspaceId,
    archivedAt: null,
    ...buildSokoBotReaderTaskWhere(authorized.reader),
  };
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      workspaceId: authorized.turn.workspaceId,
      // Explicit owner reads may inspect retained archive history; shared
      // audience reads and related-task discovery still exclude archives.
      // A turn for nobody has no owner, so it reads no archive.
      ...(authorized.askedByKind === "OWNER" && ownerId !== null
        ? {
            AND: [{ OR: [{ archivedAt: null }, { ownerId }] }],
          }
        : { archivedAt: null }),
      ...buildSokoBotReaderTaskWhere(authorized.reader),
    },
    select: {
      id: true,
      name: true,
      ownerId: true,
      creatorUserId: true,
      assigneeUserId: true,
      assigneeId: true,
      assigneeSokoBotId: true,
      description: true,
      status: true,
      archivedAt: true,
      updatedAt: true,
      dueOn: true,
      number: true,
      parentTaskId: true,
      owner: { select: { name: true } },
      assignee: { select: { id: true, name: true } },
      assigneeSokoBot: { select: { id: true, name: true } },
      project: { select: { id: true, name: true, identifier: true } },
      events: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 8,
        select: {
          id: true,
          status: true,
          comment: true,
          createdAt: true,
          coworkerId: true,
          userId: true,
          sokoBotId: true,
          sokoBot: { select: SOKO_BOT_OWNER_NAME_SELECT },
          user: { select: { name: true } },
        },
      },
      files: {
        where: { status: "READY" },
        take: 10,
        select: {
          name: true,
          fileUrl: true,
          sourceUrl: true,
          mimeType: true,
        },
      },
      subtasks: {
        where: visiblePeerTask,
        orderBy: [{ position: "asc" }, { id: "asc" }],
        take: SUBTASKS_READ_LIMIT,
        select: { id: true, name: true, status: true },
      },
      _count: { select: { subtasks: { where: visiblePeerTask } } },
      linksFrom: {
        where: {
          toTask: {
            is: visiblePeerTask,
          },
        },
        select: {
          type: true,
          note: true,
          toTask: { select: { id: true, name: true, status: true } },
        },
      },
      linksTo: {
        where: {
          fromTask: {
            is: visiblePeerTask,
          },
        },
        select: {
          type: true,
          note: true,
          fromTask: { select: { id: true, name: true, status: true } },
        },
      },
    },
  });
  if (!task) return null;
  const actor = (event: {
    coworkerId: string | null;
    userId: string | null;
    sokoBotId: string | null;
  }) =>
    event.sokoBotId
      ? event.sokoBotId === authorized.turn.sokoBotId
        ? "you"
        : "another_bot"
      : event.coworkerId
        ? "coworker"
        : event.userId
          ? // The bot's owner, not the Task's: a teammate commenting on
            // their own Task is not the person this bot works for.
            event.userId === ownerId
            ? "owner"
            : "teammate"
          : "system";
  return {
    id: task.id,
    identifier: formatTaskIdentifier(task.project?.identifier, task.number),
    name: task.name,
    ownerId: task.ownerId,
    owner: taskOwnerLabel(task, ownerId),
    requesterUserId: task.creatorUserId,
    assigneeUserId: task.assigneeUserId,
    assigneeCoworkerId: task.assigneeId,
    assigneeSokoBotId: task.assigneeSokoBotId,
    status: task.status,
    archivedAt: task.archivedAt,
    description: hideSeoAuditRequest(task.description),
    assignee: task.assignee ?? task.assigneeSokoBot,
    project: task.project
      ? { id: task.project.id, name: task.project.name }
      : null,
    parentTaskId: task.parentTaskId,
    // Its own checklist, in order: the first SUBTASKS_READ_LIMIT of them.
    subtasks: task.subtasks,
    // Every sub-task the turn can read, also those past the limit.
    subtaskCount: task._count.subtasks,
    updatedAt: task.updatedAt,
    dueOn: calendarDay(task.dueOn),
    creditsCharged: roundCredits(
      (await taskCreditsCharged([task.id])).get(task.id) ?? 0,
    ),
    events: [...task.events].reverse().map((event) => ({
      id: event.id,
      at: event.createdAt,
      author: {
        userId: event.userId,
        coworkerId: event.coworkerId,
        sokoBotId: event.sokoBotId,
      },
      by: actor(event),
      // Whose assistant wrote it: another owner's bot speaks for that
      // owner, never for yours.
      ...(event.sokoBot && event.sokoBotId !== authorized.turn.sokoBotId
        ? {
            byName: sokoBotAuthorLabel(event.sokoBot),
          }
        : event.user && event.userId !== ownerId
          ? { byName: event.user.name }
          : {}),
      status: event.status,
      comment: event.comment,
    })),
    files: task.files,
    fulfillment: await readSokoBotTaskOutcome(prisma, {
      turnId: authorized.turn.id,
      sokoBotId: authorized.turn.sokoBotId,
      workspaceId: authorized.turn.workspaceId,
      userId: authorized.turn.actingUserId,
      intentId: authorized.turn.intentId,
      intentRevision: authorized.turn.intentRevision,
      audience: authorized.askedByKind,
      taskId: task.id,
    }),
    links: [
      ...task.linksFrom.map((link) => ({
        relation: link.type,
        direction: "from-this",
        task: link.toTask,
        note: link.note,
      })),
      ...task.linksTo.map((link) => ({
        relation: link.type,
        direction: "to-this",
        task: link.fromTask,
        note: link.note,
      })),
    ],
  };
}
