import type {
  SokoBotCalendarEvent,
  SokoBotInboxMessage,
} from "@sokosumi/soko-bot";
import { parseSokoBotMemory, upcomingFollowUps } from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import {
  foreignTasksBlock,
  memoryTasks,
  tasksIn,
} from "@/lib/soko-bot/memory-task-ownership";
import { rhythmTaskScope } from "@/lib/soko-bot/rhythm-task-scope";
import {
  type ActivityStatsBot,
  activityStats,
  activityStatsLines,
} from "@/services/soko-bot-activity-stats.service";
import {
  activeIntegrationsForBot,
  fetchCalendarEvents,
  fetchInboxMessages,
  withOwnerReplies,
} from "@/services/soko-bot-integrations.service";
import { meetingPrep } from "@/services/soko-bot-meeting-evidence.service";
import {
  mailLine,
  ownerEmail,
  when,
} from "@/services/soko-bot-rhythm-context.service";

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;
/** A bot a rhythm runs for; a shared bot (`userId: null`) needs its scope. */
export type RhythmBot = ActivityStatsBot & { ingestTimezone: string };

export interface RhythmPacket {
  lines: string[];
  /** Nothing to brief on: no turn is started, nothing is spent. */
  skip: boolean;
}

/**
 * Rhythms that read an owner's own mailbox identity ("waiting on you", "you
 * sent"). A shared bot is not offered them and skips them if one exists.
 */
const OWNER_MAILBOX_RHYTHMS = new Set(["meeting-prep", "follow-ups"]);

/** The keys this module builds packets for; the stand-up and wrap live in the proactive service. */
export const RHYTHM_KEYS = new Set([
  "meeting-prep",
  "end-of-day",
  "follow-ups",
  "monday-plan",
  "monthly-review",
  "dreaming",
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
  options: {
    query?: string;
    since?: Date;
    limit: number;
    gmailOnly?: boolean;
    /** Mark what the owner answered since `since`, and leave out their sent mail. */
    replies?: boolean;
  },
): Promise<SokoBotInboxMessage[] | null> {
  const integrations = (await activeIntegrationsForBot(bot.id, "email")).filter(
    (integration) => !options.gmailOnly || integration.provider.id === "gmail",
  );
  if (integrations.length === 0) return null;
  const messages: SokoBotInboxMessage[] = [];
  for (const integration of integrations) {
    const fetched = await fetchInboxMessages(integration, {
      query: integration.provider.id === "gmail" ? options.query : undefined,
      since: options.since,
      limit: options.limit,
    }).catch(() => []);
    messages.push(
      ...(options.replies && options.since
        ? await withOwnerReplies(integration, fetched, options.since)
        : fetched),
    );
  }
  return messages;
}

function emailOf(value: string): string | null {
  return /[\w.+-]+@[\w-]+(\.[\w-]+)+/.exec(value)?.[0].toLowerCase() ?? null;
}

async function endOfDay(bot: RhythmBot, dayStart: Date): Promise<RhythmPacket> {
  const { own, visible, ownerUserId } = rhythmTaskScope(bot);
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
  const timed = events.filter((event) => !event.allDay);
  if (done.length + waiting.length + timed.length === 0)
    return { lines: [], skip: true };
  // An empty section is stated, never left out: with only "Tomorrow" in the
  // packet a bot went looking and reported a teammate's Tasks as its owner's.
  const lines: string[] = [
    "## Done today",
    ...(done.length > 0
      ? done.map(
          (task) =>
            `- "${task.name ?? "Untitled task"}"${task.assignee ? ` · ${task.assignee.name}` : ""}`,
        )
      : ["- Nothing."]),
    "",
    ownerUserId === null ? "## Waiting on the team" : "## Waiting on you",
    ...(waiting.length > 0
      ? waiting.map(
          (task) =>
            `- "${task.name ?? "Untitled task"}" (id ${task.id})${task.assignee ? ` · asked by ${task.assignee.name}` : ""}`,
        )
      : ["- Nothing."]),
    "",
  ];
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
  return { lines, skip: false };
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
    replies: true,
  });
  if (inbox === null) return { lines: [], skip: true };
  const waitingOnYou = inbox.filter(
    (message) =>
      new Date(message.receivedAt).getTime() < twoDaysAgo &&
      new Date(message.receivedAt).getTime() > now.getTime() - 14 * DAY_MS &&
      !message.repliedAt &&
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

/** The longest stretch one dream looks back over, and how much of it. */
const DREAM_WINDOW_MS = 7 * DAY_MS;
const DREAM_MAX_TURNS = 100;
const DREAM_MAX_CHATS = 60;
const DREAM_QUOTE = 240;

function quote(text: string | null, max = DREAM_QUOTE): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * What was asked in a chat turn, without the chat history Core puts in front
 * of it (`buildDirectMessagePrompt`, `buildRoomMentionPrompt`). Who asked, when
 * it was a teammate or a room mention, stays.
 */
export function chatTurnRequest(userMessage: string): string {
  const marker = "\n\nNew message:\n";
  const at = userMessage.lastIndexOf(marker);
  if (at >= 0) return userMessage.slice(at + marker.length);
  const context = userMessage.indexOf("CONTEXT (");
  const end = context < 0 ? -1 : userMessage.indexOf("\n\n", context);
  return end < 0
    ? userMessage
    : `${userMessage.slice(0, context)}${userMessage.slice(end + 2)}`;
}

/** Follow-ups the dream should drop: dated more than a week ago, or about closed Tasks. */
async function staleMemoryLines(bot: RhythmBot, now: Date): Promise<string[]> {
  const markdown = await latestMemory(bot);
  if (!markdown) return [];
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
  return lines;
}

/** Since the last dream that finished, at most a week back. */
async function dreamSince(bot: RhythmBot, now: Date): Promise<Date> {
  const last = await prisma.sokoBotScheduleRun.findFirst({
    where: {
      status: "COMPLETED",
      schedule: { sokoBotId: bot.id, systemKey: "dreaming" },
    },
    orderBy: { scheduledFor: "desc" },
    select: { scheduledFor: true },
  });
  const floor = new Date(now.getTime() - DREAM_WINDOW_MS);
  return last && last.scheduledFor > floor ? last.scheduledFor : floor;
}

/**
 * What the bot did since its last dream, for it to learn from: its chats
 * (what was asked, what it answered, the owner's thumbs), failed turns,
 * failing tools grouped so a repeat shows, answers the judge found weak, and
 * the attachments it saved. Scheduled and inbox turns count but are not
 * quoted: their prompts are Core's packets, not anyone's words. With nothing
 * new and nothing stale, there is nothing to dream about.
 */
export async function dreaming(
  bot: RhythmBot,
  now: Date,
): Promise<RhythmPacket> {
  const since = await dreamSince(bot, now);
  const [turns, failedTools, saved, stale] = await Promise.all([
    prisma.sokoBotTurn.findMany({
      where: { sokoBotId: bot.id, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: DREAM_MAX_TURNS,
      select: {
        createdAt: true,
        source: true,
        status: true,
        userMessage: true,
        finalAnswer: true,
        errorKind: true,
        ownerFeedback: true,
        qualityVerdict: true,
        backgroundTitle: true,
      },
    }),
    prisma.sokoBotToolCall.findMany({
      where: {
        status: "FAILED",
        createdAt: { gte: since },
        turn: { sokoBotId: bot.id },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { capability: true, errorKind: true },
    }),
    prisma.sokoBotToolCall.findMany({
      where: {
        capability: "save_email_attachment",
        status: "COMPLETED",
        createdAt: { gte: since },
        turn: { sokoBotId: bot.id },
      },
      select: { input: true },
    }),
    staleMemoryLines(bot, now),
  ]);
  if (turns.length === 0 && stale.length === 0)
    return { lines: [], skip: true };

  const at = (date: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: bot.ingestTimezone,
      dateStyle: "short",
      timeStyle: "short",
      hourCycle: "h23",
    }).format(date);
  const count = (source: string) =>
    turns.filter((turn) => turn.source === source).length;
  const failed = turns.filter((turn) => turn.status === "FAILED");
  const lines: string[] = [
    `## Since ${at(since)} (${bot.ingestTimezone})`,
    `${turns.length} turns: ${count("CHAT")} chats, ${count("INGEST")} inbox checks, ${count("SCHEDULE")} scheduled, ${count("EVENT")} Task events; ${failed.length} failed.`,
    "",
  ];

  const chats = turns
    .filter((turn) => turn.source === "CHAT")
    .slice(0, DREAM_MAX_CHATS)
    .reverse();
  if (chats.length > 0) {
    lines.push("## Chats, oldest first");
    for (const turn of chats) {
      const thumbs =
        turn.ownerFeedback == null
          ? ""
          : turn.ownerFeedback > 0
            ? " [thumbs up]"
            : " [thumbs down]";
      lines.push(
        `- ${at(turn.createdAt)} Asked: "${quote(chatTurnRequest(turn.userMessage))}" → You: "${quote(turn.finalAnswer, 160)}"${thumbs}`,
      );
    }
    lines.push("");
  }

  const weak = turns.flatMap((turn) => {
    const verdict = turn.qualityVerdict as {
      verdict?: string;
      issues?: string[];
    } | null;
    return verdict?.verdict === "weak" || verdict?.verdict === "fail"
      ? [
          `- ${at(turn.createdAt)} ${verdict.verdict}: ${quote((verdict.issues ?? []).join("; "), 300)}`,
        ]
      : [];
  });
  if (weak.length > 0)
    lines.push("## Answers a reviewer found weak", ...weak, "");

  if (failed.length > 0)
    lines.push(
      "## Turns that failed",
      ...failed
        .slice(0, 15)
        .map(
          (turn) =>
            `- ${at(turn.createdAt)} ${turn.source.toLowerCase()}${turn.backgroundTitle ? ` "${quote(turn.backgroundTitle, 80)}"` : ""}: ${turn.errorKind ?? "error"}`,
        ),
      "",
    );

  const toolFailures = new Map<string, number>();
  for (const call of failedTools) {
    const key = `${call.capability} (${call.errorKind ?? "error"})`;
    toolFailures.set(key, (toolFailures.get(key) ?? 0) + 1);
  }
  if (toolFailures.size > 0)
    lines.push(
      "## Tools that failed",
      ...[...toolFailures]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([key, count]) => `- ${key} ×${count}`),
      "",
    );

  // A saved mail rule that never acts shows here as nothing saved; the bot
  // can check the inbox (search_inbox) before calling it a lesson.
  const folders = new Map<string, number>();
  for (const call of saved) {
    const folder =
      (call.input as { folder?: string } | null)?.folder ?? "(no folder)";
    folders.set(folder, (folders.get(folder) ?? 0) + 1);
  }
  lines.push(
    "## Mail attachments you saved",
    folders.size > 0
      ? [...folders].map(([folder, n]) => `${folder} ×${n}`).join(" · ")
      : "None.",
    "",
  );

  lines.push(...stale);
  return { lines, skip: false };
}

export async function buildRhythmPacket(input: {
  key: string;
  bot: RhythmBot;
  now: Date;
  dayStart: Date;
}): Promise<RhythmPacket> {
  const { bot, now, dayStart } = input;
  if (
    rhythmTaskScope(bot).ownerUserId === null &&
    OWNER_MAILBOX_RHYTHMS.has(input.key)
  )
    return { lines: [], skip: true };
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
    case "dreaming":
      return dreaming(bot, now);
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
