import type {
  SokoBotCalendarEvent,
  SokoBotInboxMessage,
} from "@sokosumi/soko-bot";
import { parseSokoBotMemory, upcomingFollowUps } from "@sokosumi/soko-bot";
import { buildSokoBotOwnerTaskVisibilityWhere } from "@/helpers/task-visibility";
import prisma from "@/lib/db/prisma";
import {
  foreignTasksBlock,
  memoryTasks,
  tasksIn,
} from "@/lib/soko-bot/memory-task-ownership";
import {
  activityStats,
  activityStatsLines,
} from "@/services/soko-bot-activity-stats.service";
import {
  activeIntegrationsForBot,
  fetchCalendarEvents,
  fetchInboxMessages,
} from "@/services/soko-bot-integrations.service";

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;
const SLOT_MS = 30 * 60 * 1_000;
/** Mail providers whose domain says nothing about the company. */
const FREEMAIL = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "gmx.de",
  "gmx.net",
  "web.de",
  "proton.me",
  "protonmail.com",
]);

export interface RhythmBot {
  id: string;
  name?: string | null;
  userId: string;
  workspaceId: string;
  ingestTimezone: string;
}

export interface RhythmPacket {
  lines: string[];
  /** Nothing to brief on: no turn is started, nothing is spent. */
  skip: boolean;
}

/** The keys this module builds packets for; the stand-up and wrap live in the proactive service. */
export const RHYTHM_KEYS = new Set([
  "meeting-prep",
  "end-of-day",
  "follow-ups",
  "monday-plan",
  "monthly-review",
  "memory-cleanup",
]);

async function calendar(
  bot: RhythmBot,
  from: Date,
  to: Date,
  limit: number,
): Promise<SokoBotCalendarEvent[] | null> {
  const integrations = await activeIntegrationsForBot(bot.id, "calendar");
  if (integrations.length === 0) return null;
  const events: SokoBotCalendarEvent[] = [];
  for (const integration of integrations)
    events.push(
      ...(await fetchCalendarEvents(integration, { from, to, limit }).catch(
        () => [],
      )),
    );
  return events.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

async function mail(
  bot: RhythmBot,
  options: { query?: string; since?: Date; limit: number; gmailOnly?: boolean },
): Promise<SokoBotInboxMessage[] | null> {
  const integrations = (await activeIntegrationsForBot(bot.id, "email")).filter(
    (integration) => !options.gmailOnly || integration.provider.id === "gmail",
  );
  if (integrations.length === 0) return null;
  const messages: SokoBotInboxMessage[] = [];
  for (const integration of integrations)
    messages.push(
      ...(await fetchInboxMessages(integration, {
        query: integration.provider.id === "gmail" ? options.query : undefined,
        since: options.since,
        limit: options.limit,
      }).catch(() => [])),
    );
  return messages;
}

function when(date: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

function mailLine(message: SokoBotInboxMessage, timeZone: string): string {
  return `- ${when(message.receivedAt, timeZone)} · from ${message.from} · **${message.subject || "(no subject)"}** — ${message.snippet.replace(/\s+/g, " ").slice(0, 140)} [${message.provider}:${message.id}]`;
}

function emailOf(value: string): string | null {
  return /[\w.+-]+@[\w-]+(\.[\w-]+)+/.exec(value)?.[0].toLowerCase() ?? null;
}

function domainOf(email: string): string {
  return email.split("@")[1] ?? "";
}

/** "acme" for anna@acme.com; null for freemail, where the domain names no company. */
function companyOf(email: string): string | null {
  const domain = domainOf(email);
  if (!domain || FREEMAIL.has(domain)) return null;
  return domain.split(".")[0] ?? null;
}

async function ownerEmail(bot: RhythmBot): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: bot.userId },
    select: { email: true },
  });
  return user?.email.toLowerCase() ?? null;
}

async function openTasksMatching(bot: RhythmBot, terms: string[]) {
  if (terms.length === 0) return [];
  return prisma.task.findMany({
    where: {
      workspaceId: bot.workspaceId,
      archivedAt: null,
      status: { notIn: ["COMPLETED", "CANCELED"] },
      OR: terms.map((term) => ({
        name: { contains: term, mode: "insensitive" as const },
      })),
      AND: [buildSokoBotOwnerTaskVisibilityWhere(bot.userId)],
    },
    select: { id: true, name: true, status: true },
    take: 5,
  });
}

/**
 * External meetings starting 30–60 minutes after this run's half-hour slot.
 * The cron fires every half hour, so the windows tile the day and each
 * meeting is briefed exactly once, retries included.
 */
async function meetingPrep(
  bot: RhythmBot,
  slotAt: Date,
): Promise<RhythmPacket> {
  const slot = Math.floor(slotAt.getTime() / SLOT_MS) * SLOT_MS;
  const events = await calendar(
    bot,
    new Date(slot + SLOT_MS),
    new Date(slot + 2 * SLOT_MS),
    10,
  );
  if (!events?.length) return { lines: [], skip: true };
  const owner = await ownerEmail(bot);
  const ownDomain = owner ? domainOf(owner) : "";
  const lines: string[] = [];
  for (const event of events) {
    const start = new Date(event.startsAt).getTime();
    if (event.allDay || start < slot + SLOT_MS || start >= slot + 2 * SLOT_MS)
      continue;
    const external = event.attendees
      .map(emailOf)
      .filter(
        (email): email is string =>
          !!email && email !== owner && domainOf(email) !== ownDomain,
      );
    if (external.length === 0) continue;
    lines.push(
      `## Meeting ${when(event.startsAt, bot.ingestTimezone)}: ${event.title} [${event.provider}:${event.id}]`,
      `- From outside: ${external.slice(0, 6).join(", ")}`,
    );
    if (event.description)
      lines.push(
        `- Agenda: ${event.description.replace(/\s+/g, " ").slice(0, 300)}`,
      );
    const threads =
      (await mail(bot, {
        query: external
          .slice(0, 3)
          .map((email) => `from:${email} OR to:${email}`)
          .join(" OR "),
        since: new Date(slotAt.getTime() - 60 * DAY_MS),
        limit: 5,
      })) ?? [];
    if (threads.length > 0) {
      lines.push("- Last mail with them:");
      lines.push(
        ...threads
          .slice(0, 5)
          .map((m) => `  ${mailLine(m, bot.ingestTimezone)}`),
      );
    }
    const companies = [
      ...new Set(external.flatMap((email) => companyOf(email) ?? [])),
    ];
    const tasks = await openTasksMatching(bot, companies);
    if (tasks.length > 0) {
      lines.push("- Related open Tasks:");
      lines.push(
        ...tasks.map(
          (task) =>
            `  - ${task.status} · "${task.name ?? "Untitled task"}" (id ${task.id})`,
        ),
      );
    }
    lines.push("");
  }
  return { lines, skip: lines.length === 0 };
}

async function endOfDay(bot: RhythmBot, dayStart: Date): Promise<RhythmPacket> {
  const own = [{ ownerId: bot.userId }, { assigneeSokoBotId: bot.id }];
  const visible = buildSokoBotOwnerTaskVisibilityWhere(bot.userId);
  const [done, waiting] = await Promise.all([
    prisma.task.findMany({
      where: {
        workspaceId: bot.workspaceId,
        status: "COMPLETED",
        updatedAt: { gte: dayStart },
        OR: own,
        AND: [visible],
      },
      select: { name: true, assignee: { select: { name: true } } },
      take: 10,
    }),
    prisma.task.findMany({
      where: {
        workspaceId: bot.workspaceId,
        archivedAt: null,
        status: { in: ["INPUT_REQUIRED", "APPROVAL_REQUIRED"] },
        OR: own,
        AND: [visible],
      },
      select: { id: true, name: true, assignee: { select: { name: true } } },
      take: 10,
    }),
  ]);
  const tomorrow = new Date(dayStart.getTime() + DAY_MS);
  const events =
    (await calendar(bot, tomorrow, new Date(tomorrow.getTime() + DAY_MS), 5)) ??
    [];
  const lines: string[] = [];
  if (done.length > 0) {
    lines.push("## Done today");
    lines.push(
      ...done.map(
        (task) =>
          `- "${task.name ?? "Untitled task"}"${task.assignee ? ` · ${task.assignee.name}` : ""}`,
      ),
      "",
    );
  }
  if (waiting.length > 0) {
    lines.push("## Waiting on you");
    lines.push(
      ...waiting.map(
        (task) =>
          `- "${task.name ?? "Untitled task"}" (id ${task.id})${task.assignee ? ` · asked by ${task.assignee.name}` : ""}`,
      ),
      "",
    );
  }
  const timed = events.filter((event) => !event.allDay);
  if (timed.length > 0) {
    lines.push(`## Tomorrow (${bot.ingestTimezone})`);
    lines.push(
      ...timed.map(
        (event) =>
          `- ${when(event.startsAt, bot.ingestTimezone)}: ${event.title}`,
      ),
      "",
    );
  }
  return { lines, skip: lines.length === 0 };
}

/**
 * Mail waiting on the owner (a question, a few days old) and mail they sent
 * that got no reply. Sent mail is only searchable on Gmail; elsewhere only
 * the first half runs.
 */
async function followUpChaser(
  bot: RhythmBot,
  now: Date,
): Promise<RhythmPacket> {
  const owner = await ownerEmail(bot);
  const twoDaysAgo = now.getTime() - 2 * DAY_MS;
  const inbox = await mail(bot, {
    query: "in:inbox newer_than:21d",
    since: new Date(now.getTime() - 21 * DAY_MS),
    limit: 50,
  });
  if (inbox === null) return { lines: [], skip: true };
  const waitingOnYou = inbox.filter(
    (message) =>
      new Date(message.receivedAt).getTime() < twoDaysAgo &&
      new Date(message.receivedAt).getTime() > now.getTime() - 14 * DAY_MS &&
      emailOf(message.from) !== owner &&
      /\?/.test(`${message.subject} ${message.snippet}`),
  );
  const sent =
    (await mail(bot, {
      query: "in:sent older_than:4d newer_than:21d",
      limit: 20,
      gmailOnly: true,
    })) ?? [];
  const waitingOnOthers = sent.filter(
    (message) =>
      !inbox.some(
        (reply) =>
          reply.threadId &&
          reply.threadId === message.threadId &&
          reply.receivedAt > message.receivedAt,
      ),
  );
  const lines: string[] = [];
  if (waitingOnYou.length > 0) {
    lines.push("## Waiting on you");
    lines.push(
      ...waitingOnYou.slice(0, 10).map((m) => mailLine(m, bot.ingestTimezone)),
      "",
    );
  }
  if (waitingOnOthers.length > 0) {
    lines.push("## Waiting on others (you sent, no reply yet)");
    lines.push(
      ...waitingOnOthers
        .slice(0, 10)
        .map(
          (m) =>
            `- ${when(m.receivedAt, bot.ingestTimezone)} · to ${m.to.slice(0, 3).join(", ")} · **${m.subject || "(no subject)"}** — ${m.snippet.replace(/\s+/g, " ").slice(0, 140)} [${m.provider}:${m.id}]`,
        ),
      "",
    );
  }
  return { lines, skip: lines.length === 0 };
}

async function latestMemory(bot: RhythmBot): Promise<string | null> {
  const revision = await prisma.sokoBotMemoryRevision.findFirst({
    where: { sokoBotId: bot.id },
    orderBy: { version: "desc" },
    select: { markdown: true },
  });
  return revision?.markdown ?? null;
}

/** Follow-ups that are the owner's: none about a teammate's Task. */
async function memoryFollowUps(bot: RhythmBot): Promise<string[]> {
  const markdown = await latestMemory(bot);
  if (!markdown) return [];
  const followUps = parseSokoBotMemory(markdown).followUps;
  const known = await memoryTasks(followUps, bot);
  return followUps.filter(
    (entry) => !tasksIn(entry, known).some((task) => task.foreign),
  );
}

const DAY_STATS = (days: number) => days * DAY_MS;

async function mondayPlan(
  bot: RhythmBot,
  now: Date,
  dayStart: Date,
): Promise<RhythmPacket> {
  const events =
    (await calendar(
      bot,
      dayStart,
      new Date(dayStart.getTime() + 7 * DAY_MS),
      40,
    )) ?? [];
  const lines: string[] = activityStatsLines(
    await activityStats(
      bot,
      new Date(dayStart.getTime() - DAY_STATS(7)),
      dayStart,
    ),
    "Last week in numbers",
    bot.name ?? null,
  );
  const timed = events.filter((event) => !event.allDay);
  if (timed.length > 0) {
    const perDay = new Map<string, number>();
    for (const event of timed) {
      const day = new Intl.DateTimeFormat("en-GB", {
        timeZone: bot.ingestTimezone,
        weekday: "short",
      }).format(new Date(event.startsAt));
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
    }
    lines.push(`## This week's calendar (${bot.ingestTimezone})`);
    lines.push(
      `- Meetings per day: ${[...perDay].map(([day, count]) => `${day} ${count}`).join(", ")}`,
      ...timed
        .slice(0, 20)
        .map(
          (event) =>
            `- ${when(event.startsAt, bot.ingestTimezone)}: ${event.title}${event.attendees.length ? ` · with ${event.attendees.slice(0, 3).join(", ")}` : ""}`,
        ),
      "",
    );
  }
  const due = upcomingFollowUps(
    await memoryFollowUps(bot),
    now,
    bot.ingestTimezone,
    7,
  );
  if (due.length > 0) {
    lines.push("## Due this week (from your memory)");
    lines.push(...due.map((item) => `- ${item.date}: ${item.text}`), "");
  }
  return { lines, skip: false };
}

async function monthlyReview(
  bot: RhythmBot,
  dayStart: Date,
): Promise<RhythmPacket> {
  const monthAgo = new Date(dayStart.getTime() - 31 * DAY_MS);
  const lines = activityStatsLines(
    await activityStats(bot, monthAgo, dayStart),
    "Last 31 days in numbers",
    bot.name ?? null,
  );
  const invoices =
    (await mail(bot, {
      query:
        "(invoice OR receipt OR subscription OR renewal OR Rechnung OR Abo) newer_than:31d",
      since: monthAgo,
      limit: 15,
    })) ?? [];
  if (invoices.length > 0) {
    lines.push("## Invoices and subscriptions in mail (last 31 days)");
    lines.push(...invoices.map((m) => mailLine(m, bot.ingestTimezone)), "");
  }
  return { lines, skip: false };
}

async function memoryCleanup(bot: RhythmBot, now: Date): Promise<RhythmPacket> {
  const markdown = await latestMemory(bot);
  if (!markdown) return { lines: [], skip: false };
  const followUps = parseSokoBotMemory(markdown).followUps;
  const known = await memoryTasks([markdown], bot);
  const weekAgo = new Intl.DateTimeFormat("en-CA", {
    timeZone: bot.ingestTimezone,
  }).format(new Date(now.getTime() - 7 * DAY_MS));
  const past = followUps.filter((entry) => {
    const date = /\b\d{4}-\d{2}-\d{2}\b/.exec(entry)?.[0];
    return !!date && date < weekAgo;
  });
  const onClosed = followUps.filter((entry) =>
    tasksIn(entry, known).some((task) => task.closed),
  );
  const lines: string[] = [];
  if (past.length > 0)
    lines.push(
      "## Follow-ups dated more than a week ago",
      ...past.map((entry) => `- ${entry}`),
      "",
    );
  if (onClosed.length > 0)
    lines.push(
      "## Follow-ups about Tasks that are closed",
      ...onClosed.map((entry) => `- ${entry}`),
      "",
    );
  lines.push(...foreignTasksBlock(known));
  // Goals have no date to test, so the bot still looks at its memory weekly.
  return { lines, skip: false };
}

export async function buildRhythmPacket(input: {
  key: string;
  bot: RhythmBot;
  now: Date;
  dayStart: Date;
}): Promise<RhythmPacket> {
  const { bot, now, dayStart } = input;
  switch (input.key) {
    case "meeting-prep":
      return meetingPrep(bot, now);
    case "end-of-day":
      return endOfDay(bot, dayStart);
    case "follow-ups":
      return followUpChaser(bot, now);
    case "monday-plan":
      return mondayPlan(bot, now, dayStart);
    case "monthly-review":
      return monthlyReview(bot, dayStart);
    case "memory-cleanup":
      return memoryCleanup(bot, now);
    default:
      return { lines: [], skip: false };
  }
}

/** Deadline watch for the stand-up: memory follow-ups due in the next 48 hours. */
export async function dueSoonBlock(
  bot: RhythmBot,
  now: Date,
): Promise<string[]> {
  const soon = upcomingFollowUps(
    await memoryFollowUps(bot),
    now,
    bot.ingestTimezone,
    2,
  );
  if (soon.length === 0) return [];
  return [
    "## Due within 48h (from your memory)",
    ...soon.map((item) => `- ${item.date}: ${item.text}`),
    "",
  ];
}
