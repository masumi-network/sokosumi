import type { Prisma } from "@sokosumi/database";
import {
  dueFollowUps,
  parseSokoBotMemory,
  SOKO_BOT_SYSTEM_SCHEDULES,
  type SokoBotCalendarEvent,
  type SokoBotInboxMessage,
} from "@sokosumi/soko-bot";
import { getEnv } from "@/config/env";
import { computeNextRunWithMinimumInterval } from "@/helpers/cron";
import { buildSokoBotOwnerTaskVisibilityWhere } from "@/helpers/task-visibility";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import { INVOLVING_DELEGATION } from "@/lib/soko-bot/task-involvement";
import {
  activeIntegrationsForBot,
  fetchCalendarEvents,
  fetchInboxMessages,
} from "@/services/soko-bot-integrations.service";

const HOUR_MS = 60 * 60 * 1_000;
const NUDGE_COOLDOWN_MS = 24 * HOUR_MS;
const STALE_RUNNING_MS = 24 * HOUR_MS;
const UNANSWERED_MS = 4 * HOUR_MS;
const UNHANDLED_FAILURE_MS = 1 * HOUR_MS;
const MAX_ATTENTION = 6;
/** Older than this and it is history, not something to nudge about. */
const ATTENTION_MAX_AGE_MS = 7 * 24 * HOUR_MS;

/** Start of the bot's current local day, for the daily proactive cap. */
export function localDayStart(now: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  const minutesIntoDay = (get("hour") % 24) * 60 + get("minute");
  return new Date(now.getTime() - minutesIntoDay * 60_000);
}

export interface ProactiveGate {
  ok: boolean;
  reason?: "paused" | "global-pause" | "daily-limit";
  usedToday: number;
  limit: number;
}

/**
 * Whether the bot may start another turn on its own right now: not paused
 * by the owner or the platform, and under its daily cap of self-started
 * turns (SCHEDULE, EVENT, INGEST) for its local day.
 */
export async function proactiveGate(
  sokoBotId: string,
  now = new Date(),
): Promise<ProactiveGate> {
  const bot = await prisma.sokoBot.findUniqueOrThrow({
    where: { id: sokoBotId },
    select: {
      userId: true,
      proactivePaused: true,
      proactiveDailyLimit: true,
      ingestTimezone: true,
    },
  });
  const usedToday = await prisma.sokoBotTurn.count({
    where: {
      sokoBotId,
      createdAt: { gte: localDayStart(now, bot.ingestTimezone) },
      // Behaviour-lab turns are ours, not the owner's budget.
      clientTurnId: { not: { startsWith: "lab:" } },
      // Only what the bot decided to do by itself. A teammate mentioning it in
      // a shared room is a person asking a question, the same as the owner
      // typing one, and does not draw on the allowance for unprompted work —
      // but another bot mentioning it is a machine deciding, which is exactly
      // what this allowance is for.
      OR: [
        { source: { in: ["SCHEDULE", "EVENT", "INGEST"] } },
        { chainDepth: { gt: 0 } },
      ],
    },
  });
  const limit = bot.proactiveDailyLimit;
  if (getEnv().SOKO_BOT_PROACTIVE_PAUSED) {
    return { ok: false, reason: "global-pause", usedToday, limit };
  }
  if (bot.proactivePaused)
    return { ok: false, reason: "paused", usedToday, limit };
  if (usedToday >= limit)
    return { ok: false, reason: "daily-limit", usedToday, limit };
  return { ok: true, usedToday, limit };
}

/** Creates the built-in rhythms a bot is missing; idempotent per (bot, key). */
export async function ensureSystemSchedules(bot: {
  id: string;
  userId: string;
  workspaceId: string;
  ingestTimezone: string;
}): Promise<void> {
  const existing = await prisma.sokoBotSchedule.findMany({
    where: { sokoBotId: bot.id, systemKey: { not: null } },
    select: { systemKey: true },
  });
  const have = new Set(existing.map((row) => row.systemKey));
  for (const schedule of SOKO_BOT_SYSTEM_SCHEDULES) {
    if (have.has(schedule.key)) continue;
    const nextRunAt = computeNextRunWithMinimumInterval(
      { cron: schedule.cronExpression, timezone: bot.ingestTimezone },
      60_000,
    );
    if (!nextRunAt) continue;
    await prisma.sokoBotSchedule
      .create({
        data: {
          sokoBotId: bot.id,
          userId: bot.userId,
          workspaceId: bot.workspaceId,
          name: schedule.name,
          timezone: bot.ingestTimezone,
          cronExpression: schedule.cronExpression,
          prompt: schedule.prompt,
          systemKey: schedule.key,
          nextRunAt,
        },
      })
      .catch(() => undefined); // raced by another tick: the unique key holds
  }
}

/** Moves the built-in rhythms to a new timezone and recomputes their next run. */
export async function retimeSystemSchedules(
  sokoBotId: string,
  timeZone: string,
): Promise<void> {
  const rows = await prisma.sokoBotSchedule.findMany({
    where: { sokoBotId, systemKey: { not: null } },
    select: { id: true, cronExpression: true },
  });
  for (const row of rows) {
    const nextRunAt = computeNextRunWithMinimumInterval(
      { cron: row.cronExpression, timezone: timeZone },
      60_000,
    );
    if (!nextRunAt) continue;
    await prisma.sokoBotSchedule.update({
      where: { id: row.id },
      data: { timezone: timeZone, nextRunAt },
    });
  }
}

export interface AttentionItem {
  key: string;
  taskId: string;
  name: string;
  line: string;
}

/**
 * Deterministic "needs attention" rules over the Tasks a bot follows.
 * Returns items not raised in the last 24h; call `stageSokoBotNudges` after they
 * were handed to the bot.
 */
export async function findAttentionItems(bot: {
  id: string;
  workspaceId: string;
  followWholeBoard: boolean;
  now: Date;
  cutoverAt?: Date;
}): Promise<AttentionItem[]> {
  await prisma.sokoBotNudge.updateMany({
    where: {
      sokoBotId: bot.id,
      state: { in: ["ACTIVE", "SNOOZED", "ACKNOWLEDGED"] },
      expiresAt: { lte: bot.now },
    },
    data: { state: "EXPIRED", pendingTurnId: null, revision: { increment: 1 } },
  });
  await prisma.sokoBotNudge.updateMany({
    where: {
      sokoBotId: bot.id,
      state: "SNOOZED",
      snoozedUntil: { lte: bot.now },
    },
    data: {
      state: "ACTIVE",
      snoozedUntil: null,
      nextCheckAt: null,
      revision: { increment: 1 },
    },
  });
  const since = new Date(bot.now.getTime() - 30 * 24 * HOUR_MS);
  const delegated = await prisma.sokoBotDelegation.findMany({
    where: {
      taskId: { not: null },
      createdAt: { gte: since },
      ...INVOLVING_DELEGATION,
      turn: { sokoBotId: bot.id },
    },
    select: { taskId: true },
    distinct: ["taskId"],
  });
  const delegatedIds = delegated.flatMap((d) => (d.taskId ? [d.taskId] : []));
  const tasks = await prisma.task.findMany({
    where: {
      workspaceId: bot.workspaceId,
      archivedAt: null,
      status: { in: ["RUNNING", "INPUT_REQUIRED", "FAILED"] },
      updatedAt: {
        gte: new Date(
          Math.max(
            bot.now.getTime() - ATTENTION_MAX_AGE_MS,
            bot.cutoverAt?.getTime() ?? 0,
          ),
        ),
      },
      // Nudges stay on work this bot owns or delegated, whatever
      // `followWholeBoard` says. Following the board is for awareness — it
      // lets the bot answer when a comment names it. Sweeping every stuck or
      // failed Task in the workspace made it chase a week of other people's
      // abandoned work and, now that it can act rather than draft, restart it.
      id: { in: delegatedIds },
      OR: [{ assigneeSokoBotId: null }, { assigneeSokoBotId: { not: bot.id } }],
    },
    select: {
      id: true,
      name: true,
      status: true,
      assigneeId: true,
      assigneeSokoBotId: true,
      assignee: { select: { name: true } },
      assigneeSokoBot: { select: { name: true } },
      events: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, createdAt: true, status: true, sokoBotId: true },
      },
    },
    take: 100,
  });
  const candidates: AttentionItem[] = [];
  for (const task of tasks) {
    const last = task.events[0];
    const age = bot.now.getTime() - (last?.createdAt ?? bot.now).getTime();
    if (age > ATTENTION_MAX_AGE_MS) continue;
    const name = task.name ?? "Untitled task";
    const who =
      task.assignee?.name ?? task.assigneeSokoBot?.name ?? "the assignee";
    if (task.status === "RUNNING" && age > STALE_RUNNING_MS) {
      candidates.push({
        key: `stale:${task.id}:${last?.id ?? "initial"}`,
        taskId: task.id,
        name,
        line: `"${name}" (id ${task.id}) has been RUNNING with ${who} for ${Math.round(age / HOUR_MS)}h without an update.`,
      });
    } else if (task.status === "INPUT_REQUIRED" && age > UNANSWERED_MS) {
      candidates.push({
        key: `unanswered:${task.id}:${last?.id ?? "initial"}`,
        taskId: task.id,
        name,
        line: `"${name}" (id ${task.id}) has been waiting for input for ${Math.round(age / HOUR_MS)}h.`,
      });
    } else if (task.status === "FAILED" && age > UNHANDLED_FAILURE_MS) {
      candidates.push({
        key: `failed:${task.id}:${last?.id ?? "initial"}`,
        taskId: task.id,
        name,
        line: `"${name}" (id ${task.id}) FAILED ${Math.round(age / HOUR_MS)}h ago and nobody picked it up.`,
      });
    }
  }
  if (candidates.length === 0) return [];
  const recent = await prisma.sokoBotNudge.findMany({
    where: {
      sokoBotId: bot.id,
      key: { in: candidates.map((c) => c.key) },
      OR: [
        {
          lastDeliveredAt: {
            gte: new Date(bot.now.getTime() - NUDGE_COOLDOWN_MS),
          },
        },
        { state: { in: ["ACKNOWLEDGED", "CANCELLED", "RESOLVED", "EXPIRED"] } },
        { state: "SNOOZED", snoozedUntil: { gt: bot.now } },
        { nextCheckAt: { gt: bot.now } },
        { pendingTurnId: { not: null } },
      ],
    },
    select: { key: true },
  });
  const cooled = new Set(recent.map((r) => r.key));
  return candidates.filter((c) => !cooled.has(c.key)).slice(0, MAX_ATTENTION);
}

export async function stageSokoBotNudges(
  sokoBotId: string,
  keys: string[],
  at: Date,
  turnId: string,
): Promise<void> {
  await serializableTransaction(async (tx) => {
    const turn = await tx.sokoBotTurn.findUnique({
      where: { id: turnId },
      select: { destinationRoomId: true },
    });
    const delivered = await tx.sokoBotDelivery.findFirst({
      where: {
        turnId,
        purpose: "FINAL",
        destinationKind: "CHAT_ROOM",
        destinationId: turn?.destinationRoomId ?? "NONE",
      },
      select: { id: true, updatedAt: true, status: true, reason: true },
    });
    const published =
      delivered?.status === "PUBLISHED" && delivered.reason !== "SILENT";
    const terminal =
      delivered &&
      ["SUPPRESSED", "BLOCKED", "DEAD_LETTER", "PUBLISHED"].includes(
        delivered.status,
      );
    for (const key of keys) {
      await tx.sokoBotNudge.upsert({
        where: { sokoBotId_key: { sokoBotId, key } },
        create: {
          sokoBotId,
          key,
          lastAt: at,
          pendingTurnId: terminal ? null : turnId,
          lastDeliveryId: published ? delivered.id : undefined,
          lastDeliveredAt: published ? delivered.updatedAt : undefined,
          nextCheckAt:
            terminal && !published
              ? new Date(at.getTime() + 60_000)
              : undefined,
          expiresAt: new Date(at.getTime() + 7 * 24 * HOUR_MS),
        },
        update: {
          lastAt: at,
          pendingTurnId: terminal ? null : turnId,
          lastDeliveryId: published ? delivered.id : undefined,
          lastDeliveredAt: published ? delivered.updatedAt : undefined,
          nextCheckAt:
            terminal && !published
              ? new Date(at.getTime() + 60_000)
              : undefined,
        },
      });
    }
  }, "Reminder staging collided with delivery");
}

export function attentionBlock(items: AttentionItem[]): string[] {
  if (items.length === 0) return [];
  return ["## Needs attention", ...items.map((item) => `- ${item.line}`), ""];
}

/** "Follow-ups due" lines from the bot's latest memory. */
export async function followUpsBlock(
  sokoBotId: string,
  timeZone: string,
  now: Date,
): Promise<string[]> {
  const revision = await prisma.sokoBotMemoryRevision.findFirst({
    where: { sokoBotId },
    orderBy: { version: "desc" },
    select: { markdown: true },
  });
  if (!revision) return [];
  const memory = parseSokoBotMemory(revision.markdown);
  const due = dueFollowUps(memory.followUps, now, timeZone);
  if (due.length === 0) return [];
  return [
    "## Follow-ups due (from your memory)",
    ...due.map(
      (item) => `- ${item.overdue ? "overdue" : "today"}: ${item.text}`,
    ),
    "",
  ];
}

/** The live packet for a built-in rhythm turn. */
export async function buildSystemBeatMessage(input: {
  bot: {
    id: string;
    coworkerId?: string | null;
    userId: string;
    workspaceId: string;
    ingestTimezone: string;
    followWholeBoard: boolean;
  };
  key: string;
  prompt: string;
  now: Date;
}): Promise<{ message: string; nudgeKeys: string[] }> {
  const { bot, now } = input;
  const lines: string[] = [input.prompt, ""];
  const nudgeKeys: string[] = [];
  if (input.key === "standup") {
    const events: SokoBotCalendarEvent[] = [];
    for (const integration of await activeIntegrationsForBot(
      bot.id,
      "calendar",
    )) {
      events.push(
        ...(await fetchCalendarEvents(integration, {
          from: new Date(now.getTime() - HOUR_MS),
          to: new Date(now.getTime() + 36 * HOUR_MS),
          limit: 15,
        }).catch(() => [])),
      );
    }
    if (events.length > 0) {
      lines.push(`## Calendar (${bot.ingestTimezone})`);
      for (const event of events.slice(0, 15)) {
        const when = event.allDay
          ? "all day"
          : new Intl.DateTimeFormat("en-GB", {
              timeZone: bot.ingestTimezone,
              weekday: "short",
              hour: "2-digit",
              minute: "2-digit",
            }).format(new Date(event.startsAt));
        lines.push(
          `- ${when}: ${event.title}${event.attendees.length ? ` · with ${event.attendees.slice(0, 4).join(", ")}` : ""} [${event.provider}:${event.id}]`,
        );
      }
      lines.push("");
    }
    const mail: SokoBotInboxMessage[] = [];
    for (const integration of await activeIntegrationsForBot(bot.id, "email")) {
      mail.push(
        ...(await fetchInboxMessages(integration, {
          since: new Date(now.getTime() - 24 * HOUR_MS),
          unreadOnly: true,
          limit: 15,
        }).catch(() => [])),
      );
    }
    if (mail.length > 0) {
      lines.push("## Unread mail (last 24h)");
      for (const message of mail.slice(0, 15)) {
        lines.push(
          `- from ${message.from} · **${message.subject || "(no subject)"}** — ${message.snippet.replace(/\s+/g, " ").slice(0, 140)} [${message.provider}:${message.id}]`,
        );
      }
      lines.push("");
    }
  }
  {
    const items = await findAttentionItems({
      id: bot.id,
      workspaceId: bot.workspaceId,
      followWholeBoard: bot.followWholeBoard,
      now,
    });
    lines.push(...attentionBlock(items));
    nudgeKeys.push(...items.map((item) => item.key));
  }
  const open = await prisma.task.findMany({
    where: {
      workspaceId: bot.workspaceId,
      archivedAt: null,
      status: { notIn: ["COMPLETED", "CANCELED"] },
      ...(bot.followWholeBoard
        ? {}
        : {
            OR: [
              { assigneeSokoBotId: bot.id },
              { sokoBotWatches: { some: { sokoBotId: bot.id } } },
            ],
          }),
      AND: [buildSokoBotOwnerTaskVisibilityWhere(bot.userId)],
    },
    select: {
      id: true,
      name: true,
      status: true,
      assignee: { select: { name: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 12,
  });
  if (open.length > 0) {
    lines.push("## Open on the board");
    for (const task of open) {
      lines.push(
        `- ${task.status} · "${task.name ?? "Untitled task"}" (id ${task.id})${task.assignee ? ` · ${task.assignee.name}` : ""}`,
      );
    }
    lines.push("");
  }
  lines.push(...(await followUpsBlock(bot.id, bot.ingestTimezone, now)));
  return { message: lines.join("\n").trim(), nudgeKeys };
}

/** Called inside the runtime mutation transaction, after owner authority checks. */
export async function manageSokoBotReminder(
  tx: Prisma.TransactionClient,
  input: {
    sokoBotId: string;
    key: string;
    action: "ACKNOWLEDGE" | "SNOOZE" | "CANCEL";
    revision: number;
    snoozedUntil?: string;
  },
  now = new Date(),
) {
  const until = input.snoozedUntil ? new Date(input.snoozedUntil) : null;
  if (
    input.action === "SNOOZE" &&
    (!until ||
      until <= now ||
      until.getTime() > now.getTime() + 30 * 24 * HOUR_MS)
  ) {
    return {
      applied: false,
      reason: "Snooze must end within the next 30 days.",
    };
  }
  const changed = await tx.sokoBotNudge.updateMany({
    where: {
      sokoBotId: input.sokoBotId,
      key: input.key,
      revision: input.revision,
      state: { in: ["ACTIVE", "ACKNOWLEDGED", "SNOOZED"] },
    },
    data: {
      state:
        input.action === "ACKNOWLEDGE"
          ? "ACKNOWLEDGED"
          : input.action === "SNOOZE"
            ? "SNOOZED"
            : "CANCELLED",
      acknowledgedAt: input.action === "ACKNOWLEDGE" ? now : undefined,
      snoozedUntil: input.action === "SNOOZE" ? until : null,
      nextCheckAt: input.action === "SNOOZE" ? until : null,
      revision: { increment: 1 },
    },
  });
  const reminder =
    changed.count === 1
      ? await tx.sokoBotNudge.findUnique({
          where: {
            sokoBotId_key: { sokoBotId: input.sokoBotId, key: input.key },
          },
          select: { id: true },
        })
      : null;
  return {
    id: reminder?.id ?? null,
    applied: changed.count === 1,
    key: input.key,
    revision: input.revision + (changed.count === 1 ? 1 : 0),
  };
}
