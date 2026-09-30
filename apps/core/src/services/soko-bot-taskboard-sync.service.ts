import { createHash } from "node:crypto";
import { withBetaBotOwner } from "@/helpers/soko-bot-beta";
import { buildSokoBotOwnerTaskVisibilityWhere } from "@/helpers/task-visibility";
import prisma from "@/lib/db/prisma";
import { SYSTEM_TURN_ROUTES } from "@/lib/soko-bot/system-routes";
import {
  commentNamesBot,
  INVOLVING_DELEGATION,
} from "@/lib/soko-bot/task-involvement";
import {
  SokoBotBusyError,
  sokoBotControlPlane,
} from "@/services/soko-bot-control-plane.service";
import {
  attentionBlock,
  ensureSystemSchedules,
  findAttentionItems,
  followUpsBlock,
  proactiveGate,
  stageSokoBotNudges,
} from "@/services/soko-bot-proactive.service";

const WATCH_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_TASKS_PER_TURN = 6;
const MAX_EVENTS_PER_TASK = 5;
/** Statuses in which a Task assigned to the bot is waiting for the bot. */
const WORK_STATUSES = new Set(["READY", "QUEUED"]);

const TERMINAL = ["COMPLETED", "CANCELED", "DRAFT"] as const;

export interface SokoBotTaskboardSyncInput {
  abortSignal: AbortSignal;
  shouldContinue: () => boolean;
}

export interface SokoBotTaskboardSyncResult {
  bots: number;
  woken: number;
  deferred: number;
  failed: number;
}

interface TaskUpdate {
  taskId: string;
  name: string;
  status: string;
  assignedToBot: boolean;
  /** Bot must act: assigned and waiting for it. */
  work: boolean;
  cursor?: { at: Date; id: string };
  designatedHandlerBotId?: string | null;
  events: {
    id?: string;
    at: Date;
    by: string;
    status: string | null;
    comment: string | null;
  }[];
}

function actorLabel(event: {
  userId: string | null;
  coworkerId: string | null;
  sokoBotId: string | null;
  user: { name: string | null } | null;
  coworker: { name: string | null } | null;
  sokoBot: { name: string | null } | null;
}): string {
  if (event.userId) return event.user?.name?.trim() || "a teammate";
  if (event.coworkerId)
    return `Coworker ${event.coworker?.name?.trim() || ""}`.trim();
  if (event.sokoBotId) {
    return event.sokoBot?.name?.trim() || "a personal assistant";
  }
  return "the system";
}

export function buildTaskboardMessage(updates: TaskUpdate[]): string {
  const work = updates.filter((u) => u.work);
  const rest = updates.filter((u) => !u.work);
  const lines: string[] = [];
  if (work.length > 0) {
    lines.push("## Tasks assigned to you");
    for (const task of work) {
      lines.push(
        `- "${task.name}" (id ${task.taskId}) is ${task.status} and waiting for you.`,
      );
      for (const event of task.events) {
        if (event.comment) lines.push(`  - ${actorLine(event)}`);
      }
    }
    lines.push("");
  }
  if (rest.length > 0) {
    lines.push("## New on Tasks you follow");
    for (const task of rest) {
      lines.push(
        `- "${task.name}" (id ${task.taskId}, ${task.status}${task.assignedToBot ? ", assigned to you" : ""}):`,
      );
      for (const event of task.events) lines.push(`  - ${actorLine(event)}`);
    }
    lines.push("");
  }
  lines.push(
    "Follow your Taskboard collaboration skill: work Tasks assigned to you with update_assigned_task; on Tasks you only follow, add one comment with reply_to_task only when you have information the Task does not have yet, otherwise answer exactly `Nothing to add.`",
  );
  return lines.join("\n").trim();
}

function actorLine(event: TaskUpdate["events"][number]): string {
  const status = event.status ? ` set ${event.status}` : "";
  const comment = event.comment
    ? `: ${event.comment.replace(/\s+/g, " ").trim().slice(0, 500)}`
    : "";
  return `${event.by}${status}${comment || (status ? "" : " updated the Task")}`;
}

/**
 * Tells each bot what others did on Tasks it is assigned to or created,
 * and hands it Tasks that were assigned to it. Poll-based like the other
 * syncs: one cursor per (bot, task), idempotent, busy bots get it next tick.
 */
export class SokoBotTaskboardSyncService {
  async syncTaskboard(
    input: SokoBotTaskboardSyncInput,
  ): Promise<SokoBotTaskboardSyncResult> {
    const result: SokoBotTaskboardSyncResult = {
      bots: 0,
      woken: 0,
      deferred: 0,
      failed: 0,
    };
    const since = new Date(Date.now() - WATCH_WINDOW_MS);
    const scan = await prisma.syncMetadata.upsert({
      where: { key: "soko-taskboard-bots-v2" },
      create: { key: "soko-taskboard-bots-v2", lastSyncedAt: new Date() },
      update: {},
    });
    const bots = await prisma.sokoBot.findMany({
      orderBy: { id: "asc" },
      take: 50,
      where: withBetaBotOwner({
        ...(scan.cursorId ? { id: { gt: scan.cursorId } } : {}),
        archivedAt: null,
        adminPausedAt: null,
      }),
      select: {
        id: true,
        name: true,
        userId: true,
        workspaceId: true,
        followWholeBoard: true,
        ingestTimezone: true,
      },
    });
    for (const bot of bots) {
      if (!input.shouldContinue()) break;
      result.bots += 1;
      try {
        await ensureSystemSchedules(bot);
        const woke = await this.syncBot(
          {
            id: bot.id,
            name: bot.name,
            userId: bot.userId,
            workspaceId: bot.workspaceId,
            followWholeBoard: bot.followWholeBoard,
            ingestTimezone: bot.ingestTimezone,
          },
          since,
          input.abortSignal,
          scan.createdAt,
        );
        if (woke) result.woken += 1;
      } catch (error) {
        if (error instanceof SokoBotBusyError) {
          result.deferred += 1;
          continue;
        }
        result.failed += 1;
        console.error("Soko Bot taskboard sync failed", {
          sokoBotId: bot.id,
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    }
    if (input.shouldContinue() && !input.abortSignal.aborted)
      await prisma.syncMetadata.update({
        where: { key: scan.key },
        data: {
          cursorId: bots.length === 50 ? bots.at(-1)?.id : null,
          lastSyncedAt: new Date(),
        },
      });
    return result;
  }

  private async syncBot(
    bot: {
      id: string;
      name: string | null;
      userId: string;
      workspaceId: string;
      followWholeBoard: boolean;
      ingestTimezone: string;
    },
    since: Date,
    abortSignal: AbortSignal,
    cutoverAt: Date,
  ): Promise<boolean> {
    const scan = await prisma.syncMetadata.upsert({
      where: { key: `soko-taskboard-v2:${bot.id}` },
      create: {
        key: `soko-taskboard-v2:${bot.id}`,
        lastSyncedAt: new Date(),
        createdAt: cutoverAt,
      },
      update: {},
    });
    const readTaskPage = (cursor?: string | null) =>
      prisma.task.findMany({
        where: {
          ...(cursor ? { id: { gt: cursor } } : {}),
          workspaceId: bot.workspaceId,
          archivedAt: null,
          AND: [
            {
              OR: [
                {
                  assigneeSokoBotId: bot.id,
                  status: { notIn: [...TERMINAL] },
                },
                {
                  sokoBotDelegations: {
                    some: {
                      ...INVOLVING_DELEGATION,
                      turn: { sokoBotId: bot.id },
                    },
                  },
                  updatedAt: { gte: since },
                },
                ...(bot.followWholeBoard
                  ? [
                      {
                        status: { notIn: [...TERMINAL] },
                        updatedAt: { gte: since },
                      },
                    ]
                  : []),
              ],
            },
            buildSokoBotOwnerTaskVisibilityWhere(bot.userId),
          ],
        },
        select: {
          id: true,
          name: true,
          status: true,
          ownerId: true,
          assigneeId: true,
          assigneeSokoBotId: true,
          updatedAt: true,
          sokoBotDelegations: {
            where: { ...INVOLVING_DELEGATION, turn: { sokoBotId: bot.id } },
            take: 1,
            select: { id: true },
          },
          sokoBotWatches: {
            where: { sokoBotId: bot.id },
            select: {
              id: true,
              lastSeenEventAt: true,
              lastSeenEventId: true,
              lastSeenStatus: true,
            },
          },
        },
        orderBy: { id: "asc" },
        take: 50,
      });
    const tasks = await readTaskPage(scan.cursorId);
    const taskIds = new Set(
      tasks
        .filter((task) => task.sokoBotDelegations.length > 0)
        .map((task) => task.id),
    );
    const now = new Date();
    const updates: TaskUpdate[] = [];
    const baselines: {
      taskId: string;
      status: string;
      watchId?: string;
      cursor?: { at: Date; id: string };
    }[] = [];
    for (const task of tasks) {
      if (abortSignal.aborted) return false;
      const watch = task.sokoBotWatches[0] ?? null;
      const assignedToBot = task.assigneeSokoBotId === bot.id;
      const work = assignedToBot && WORK_STATUSES.has(task.status);
      // Board-only Tasks: the bot neither owns nor created them.
      const boardOnly = !assignedToBot && !taskIds.has(task.id);
      if (task.updatedAt < scan.createdAt) {
        baselines.push({
          taskId: task.id,
          status: task.status,
          cursor: { at: scan.createdAt, id: "" },
        });
        continue;
      }
      if (!watch) {
        // First sight: baseline silently unless the Task is waiting for the bot.
        if (!work) {
          baselines.push({ taskId: task.id, status: task.status });
          continue;
        }
      }
      const events = await prisma.taskEvent.findMany({
        where: {
          taskId: task.id,
          AND: [
            {
              ...(!watch && work
                ? { createdAt: { gte: scan.createdAt } }
                : {
                    OR: [
                      {
                        createdAt: {
                          gt: new Date(
                            Math.max(
                              (watch?.lastSeenEventAt ?? since).getTime(),
                              scan.createdAt.getTime(),
                            ),
                          ),
                        },
                      },
                      ...(watch?.lastSeenEventId &&
                      watch.lastSeenEventAt >= scan.createdAt
                        ? [
                            {
                              createdAt: watch.lastSeenEventAt,
                              id: { gt: watch.lastSeenEventId },
                            },
                          ]
                        : []),
                    ],
                  }),
            },
            { OR: [{ sokoBotId: null }, { sokoBotId: { not: bot.id } }] },
          ],
        },
        orderBy:
          !watch && work
            ? [{ createdAt: "desc" }, { id: "desc" }]
            : [{ createdAt: "asc" }, { id: "asc" }],
        take: !watch && work ? 1 : MAX_EVENTS_PER_TASK,
        select: {
          id: true,
          createdAt: true,
          status: true,
          comment: true,
          userId: true,
          coworkerId: true,
          sokoBotId: true,
          user: { select: { name: true } },
          coworker: { select: { name: true } },
          sokoBot: { select: { name: true } },
        },
      });
      const consumed = events.length
        ? await prisma.sokoBotEventInbox.findMany({
            where: {
              botId: bot.id,
              purpose: "TASK_EVENT",
              eventId: { in: events.map((event) => event.id) },
            },
            select: { eventId: true },
          })
        : [];
      const consumedIds = new Set(consumed.map((entry) => entry.eventId));
      if (events.length && events.every((event) => consumedIds.has(event.id))) {
        const last = events[events.length - 1];
        baselines.push({
          taskId: task.id,
          status: task.status,
          cursor: { at: last.createdAt, id: last.id },
        });
        continue;
      }
      const alreadyHandedOver =
        work && watch?.lastSeenStatus === task.status && events.length === 0;
      if (alreadyHandedOver) continue;
      // Status drift on Tasks the bot delegated is the events sync's job
      // (it wakes with the latest comment); here only comment-only events
      // on those Tasks count, so one change never produces two turns.
      // A Task the bot is not part of, and another bot's comment anywhere,
      // reach it only when they name it: otherwise one question woke every
      // bot on the board, and each answer woke the rest.
      const meaningful = events
        .filter((event) => !consumedIds.has(event.id))
        .filter((e) => {
          const named =
            Boolean(e.comment) && commentNamesBot(e.comment ?? "", bot.name);
          if (boardOnly || (e.sokoBotId && !e.status)) return named;
          return assignedToBot
            ? Boolean(e.comment || e.status)
            : Boolean(e.comment) && !e.status;
        });
      if (!work && meaningful.length === 0) {
        if (events.length > 0 && watch) {
          baselines.push({
            taskId: task.id,
            status: task.status,
            watchId: watch.id,
            cursor: {
              at: events[events.length - 1].createdAt,
              id: events[events.length - 1].id,
            },
          });
        }
        continue;
      }
      // Do not re-enqueue a trailing event already consumed by delegation
      // sync: its inbox uniqueness would block this earlier pending batch.
      const cursorEvent = meaningful.at(-1) ?? events.at(-1);
      updates.push({
        taskId: task.id,
        name: task.name ?? "Untitled task",
        status: task.status,
        assignedToBot,
        work,
        designatedHandlerBotId:
          task.assigneeSokoBotId ??
          (taskIds.has(task.id) && task.ownerId === bot.userId ? bot.id : null),
        cursor: cursorEvent
          ? { at: cursorEvent.createdAt, id: cursorEvent.id }
          : undefined,
        events: meaningful.map((e) => ({
          id: e.id,
          at: e.createdAt,
          by: actorLabel(e),
          status: e.status,
          comment: e.comment,
        })),
      });
    }

    await this.stamp(bot.id, baselines, now);
    if (!abortSignal.aborted)
      await prisma.syncMetadata.update({
        where: { key: scan.key },
        data: {
          cursorId: tasks.length === 50 ? tasks.at(-1)?.id : null,
          lastSyncedAt: now,
        },
      });
    const attention = await findAttentionItems({
      id: bot.id,
      workspaceId: bot.workspaceId,
      followWholeBoard: bot.followWholeBoard,
      now,
      cutoverAt: scan.createdAt,
    });
    const followUps = await followUpsBlock(bot.id, bot.ingestTimezone, now);
    if (updates.length === 0 && attention.length === 0) return false;
    // Every turn the bot starts counts, assigned work included. Exempting it
    // meant anyone who could put a Task on the bot could drive unlimited
    // billed turns, and a bot that assigned work to itself could loop on the
    // one-minute cron forever. The owner's limit is the number they set.
    const gate = await proactiveGate(bot.id, now);
    if (!gate.ok) return false;
    const batch = updates.slice(0, MAX_TASKS_PER_TURN);
    const message = [
      ...(batch.length > 0 ? [buildTaskboardMessage(batch), ""] : []),
      ...attentionBlock(attention),
      ...followUps,
      ...(batch.length === 0
        ? [
            "Move each item that needs attention: nudge the Coworker with reply_to_task in one concrete sentence, ask the owner one question, or adjust the schedule. Then report in two lines or answer exactly `Nothing to add.`",
          ]
        : []),
    ]
      .join("\n")
      .trim();
    const started = await sokoBotControlPlane.startTurn({
      userId: bot.userId,
      workspaceId: bot.workspaceId,
      clientTurnId: `taskboard:${createHash("sha256")
        .update(
          JSON.stringify({
            botId: bot.id,
            events: batch
              .map((u) => [u.taskId, u.cursor?.id ?? u.status])
              .sort(),
            attention: attention.map((a) => a.key).sort(),
            day: now.toISOString().slice(0, 10),
          }),
        )
        .digest("hex")}`,
      message,
      source: "EVENT",
      presetRoute: SYSTEM_TURN_ROUTES.taskboard,
      eventBatch: batch.flatMap((item) => {
        const ids = [
          ...new Set([
            ...item.events.flatMap((event) => (event.id ? [event.id] : [])),
            item.cursor?.id ?? `${item.taskId}:${item.status}`,
          ]),
        ];
        return ids.map((eventId) => ({
          eventId,
          entityId: item.taskId,
          purpose: "TASK_EVENT",
          status: item.status,
          designatedHandlerBotId: item.designatedHandlerBotId ?? null,
          ...(eventId === (item.cursor?.id ?? `${item.taskId}:${item.status}`)
            ? { taskCursorAt: item.cursor?.at ?? now }
            : {}),
        }));
      }),
    });
    await stageSokoBotNudges(
      bot.id,
      attention.map((item) => item.key),
      now,
      started.turnId,
    );
    if (
      started.reconciliationLeaseToken &&
      (started.status === "STARTING" || started.status === "RUNNING")
    ) {
      await sokoBotControlPlane
        .reconcileTurn(
          started.turnId,
          abortSignal,
          started.reconciliationLeaseToken,
        )
        .catch((error) => {
          console.error("Soko Bot taskboard turn reconciliation failed", {
            turnId: started.turnId,
            error: error instanceof Error ? error.message : "unknown",
          });
        });
    }
    return true;
  }

  private async stamp(
    sokoBotId: string,
    items: {
      taskId: string;
      status: string;
      cursor?: { at: Date; id: string };
    }[],
    at: Date,
  ) {
    for (const item of items) {
      await prisma.sokoBotTaskWatch.upsert({
        where: { sokoBotId_taskId: { sokoBotId, taskId: item.taskId } },
        create: {
          sokoBotId,
          taskId: item.taskId,
          lastSeenEventAt: item.cursor?.at ?? at,
          lastSeenEventId: item.cursor?.id ?? null,
          lastSeenStatus: item.status,
        },
        update: {
          lastSeenEventAt: item.cursor?.at ?? at,
          lastSeenEventId: item.cursor?.id ?? null,
          lastSeenStatus: item.status,
        },
      });
    }
  }
}

export const sokoBotTaskboardSyncService = new SokoBotTaskboardSyncService();
