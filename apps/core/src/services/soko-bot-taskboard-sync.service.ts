import { withBetaBotOwner } from "@/helpers/soko-bot-beta";
import prisma from "@/lib/db/prisma";
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
  stampNudges,
} from "@/services/soko-bot-proactive.service";

const WATCH_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_TASKS_PER_TURN = 6;
const MAX_EVENTS_PER_TASK = 5;
/** Statuses in which a Task assigned to the bot is waiting for the bot. */
const WORK_STATUSES = new Set(["READY", "QUEUED"]);

const TERMINAL = ["COMPLETED", "CANCELED", "DRAFT"] as const;

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 6),
  );
}

/**
 * Cheap pre-filter for board-wide following: a comment reaches the bot only
 * when it addresses the bot, asks something, or overlaps with what the bot
 * already knows (memory). Everything else never becomes a turn.
 */
export function isRelevantBoardComment(input: {
  comment: string;
  botName: string | null;
  memoryTokens: Set<string>;
}): boolean {
  const text = input.comment.trim();
  if (!text) return false;
  const name = input.botName?.trim().toLowerCase();
  if (name && text.toLowerCase().includes(name)) return true;
  if (/\?/.test(text)) return true;
  for (const word of tokens(text)) {
    if (input.memoryTokens.has(word)) return true;
  }
  return false;
}

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
  events: {
    at: Date;
    by: string;
    status: string | null;
    comment: string | null;
  }[];
}

function actorLabel(event: {
  userId: string | null;
  coworkerId: string | null;
  user: { name: string | null } | null;
  coworker: { name: string | null } | null;
}): string {
  if (event.userId) return event.user?.name?.trim() || "a teammate";
  if (event.coworkerId)
    return `Coworker ${event.coworker?.name?.trim() || ""}`.trim();
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
    const bots = await prisma.sokoBot.findMany({
      where: withBetaBotOwner({
        archivedAt: null,
        adminPausedAt: null,
        coworker: { isNot: null },
      }),
      select: {
        id: true,
        name: true,
        userId: true,
        workspaceId: true,
        followWholeBoard: true,
        ingestTimezone: true,
        coworker: { select: { id: true } },
        memoryRevisions: {
          orderBy: { version: "desc" },
          take: 1,
          select: { markdown: true },
        },
      },
    });
    for (const bot of bots) {
      if (!input.shouldContinue()) break;
      if (!bot.coworker) continue;
      result.bots += 1;
      try {
        await ensureSystemSchedules(bot);
        const woke = await this.syncBot(
          {
            id: bot.id,
            name: bot.name,
            userId: bot.userId,
            workspaceId: bot.workspaceId,
            coworkerId: bot.coworker.id,
            followWholeBoard: bot.followWholeBoard,
            ingestTimezone: bot.ingestTimezone,
            memoryTokens: tokens(bot.memoryRevisions[0]?.markdown ?? ""),
          },
          since,
          input.abortSignal,
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
    return result;
  }

  private async syncBot(
    bot: {
      id: string;
      name: string | null;
      userId: string;
      workspaceId: string;
      coworkerId: string;
      followWholeBoard: boolean;
      ingestTimezone: string;
      memoryTokens: Set<string>;
    },
    since: Date,
    abortSignal: AbortSignal,
  ): Promise<boolean> {
    const delegated = await prisma.sokoBotDelegation.findMany({
      where: {
        taskId: { not: null },
        createdAt: { gte: since },
        turn: { sokoBotId: bot.id },
      },
      select: { taskId: true },
      distinct: ["taskId"],
    });
    const taskIds = new Set(
      delegated.flatMap((d) => (d.taskId ? [d.taskId] : [])),
    );
    const tasks = await prisma.task.findMany({
      where: {
        workspaceId: bot.workspaceId,
        archivedAt: null,
        OR: [
          { assigneeId: bot.coworkerId, status: { notIn: [...TERMINAL] } },
          { id: { in: Array.from(taskIds) }, updatedAt: { gte: since } },
          ...(bot.followWholeBoard
            ? [{ status: { notIn: [...TERMINAL] }, updatedAt: { gte: since } }]
            : []),
        ],
      },
      select: {
        id: true,
        name: true,
        status: true,
        assigneeId: true,
        updatedAt: true,
        sokoBotWatches: {
          where: { sokoBotId: bot.id },
          select: { id: true, lastSeenEventAt: true, lastSeenStatus: true },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });
    const now = new Date();
    const updates: TaskUpdate[] = [];
    const baselines: { taskId: string; status: string; watchId?: string }[] =
      [];
    for (const task of tasks) {
      const watch = task.sokoBotWatches[0] ?? null;
      const assignedToBot = task.assigneeId === bot.coworkerId;
      const work = assignedToBot && WORK_STATUSES.has(task.status);
      // Board-only Tasks: the bot neither owns nor created them.
      const boardOnly = !assignedToBot && !taskIds.has(task.id);
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
          createdAt: { gt: watch?.lastSeenEventAt ?? since },
          OR: [{ orchestratorId: null }, { orchestratorId: { not: bot.id } }],
        },
        orderBy: { createdAt: "asc" },
        take: MAX_EVENTS_PER_TASK,
        select: {
          createdAt: true,
          status: true,
          comment: true,
          userId: true,
          coworkerId: true,
          user: { select: { name: true } },
          coworker: { select: { name: true } },
        },
      });
      const alreadyHandedOver =
        work && watch?.lastSeenStatus === task.status && events.length === 0;
      if (alreadyHandedOver) continue;
      // Status drift on Tasks the bot delegated is the events sync's job
      // (it wakes with the latest comment); here only comment-only events
      // on those Tasks count, so one change never produces two turns.
      const meaningful = events.filter((e) =>
        boardOnly
          ? Boolean(e.comment) &&
            isRelevantBoardComment({
              comment: e.comment ?? "",
              botName: bot.name,
              memoryTokens: bot.memoryTokens,
            })
          : assignedToBot
            ? e.comment || e.status
            : Boolean(e.comment) && !e.status,
      );
      if (!work && meaningful.length === 0) {
        if (events.length > 0 && watch) {
          baselines.push({
            taskId: task.id,
            status: task.status,
            watchId: watch.id,
          });
        }
        continue;
      }
      updates.push({
        taskId: task.id,
        name: task.name ?? "Untitled task",
        status: task.status,
        assignedToBot,
        work,
        events: meaningful.map((e) => ({
          at: e.createdAt,
          by: actorLabel(e),
          status: e.status,
          comment: e.comment,
        })),
      });
    }

    await this.stamp(bot.id, baselines, now);
    const attention = await findAttentionItems({
      id: bot.id,
      coworkerId: bot.coworkerId,
      workspaceId: bot.workspaceId,
      followWholeBoard: bot.followWholeBoard,
      now,
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
      clientTurnId: `taskboard:${bot.id}:${now.toISOString().slice(0, 16)}`,
      message,
      source: "EVENT",
    });
    await this.stamp(
      bot.id,
      batch.map((u) => ({ taskId: u.taskId, status: u.status })),
      now,
    );
    await stampNudges(
      bot.id,
      attention.map((item) => item.key),
      now,
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
    items: { taskId: string; status: string }[],
    at: Date,
  ) {
    for (const item of items) {
      await prisma.sokoBotTaskWatch.upsert({
        where: { sokoBotId_taskId: { sokoBotId, taskId: item.taskId } },
        create: {
          sokoBotId,
          taskId: item.taskId,
          lastSeenEventAt: at,
          lastSeenStatus: item.status,
        },
        update: { lastSeenEventAt: at, lastSeenStatus: item.status },
      });
    }
  }
}

export const sokoBotTaskboardSyncService = new SokoBotTaskboardSyncService();
