import { parseSokoBotMemory } from "@sokosumi/soko-bot";
import { DAY_MS } from "@/config/constants";
import prisma from "@/lib/db/prisma";
import { evalHistoryFloor } from "@/lib/evals/eval-history";
import {
  foreignTasksBlock,
  memoryTasks,
  tasksIn,
} from "@/lib/soko-bot/memory-task-ownership";
import { latestMemory } from "./soko-bot-rhythm-memory";
import type { RhythmBot, RhythmPacket } from "./soko-bot-rhythms.service";

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
  const [checkpoint, reset] = await Promise.all([
    dreamSince(bot, now),
    evalHistoryFloor({ workspaceId: bot.workspaceId, sokoBotId: bot.id }),
  ]);
  const since = reset && reset > checkpoint ? reset : checkpoint;
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
        errorDetail: true,
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
      select: { capability: true, errorKind: true, errorDetail: true },
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
            `- ${at(turn.createdAt)} ${turn.source.toLowerCase()}${turn.backgroundTitle ? ` "${quote(turn.backgroundTitle, 80)}"` : ""}: ${turn.errorKind ?? "error"}${turn.errorDetail ? ` (${quote(turn.errorDetail, 140)})` : ""}`,
        ),
      "",
    );

  const toolFailures = new Map<
    string,
    { count: number; detail: string | null }
  >();
  for (const call of failedTools) {
    const key = `${call.capability} (${call.errorKind ?? "error"})`;
    const entry = toolFailures.get(key) ?? {
      count: 0,
      detail: call.errorDetail,
    };
    entry.count += 1;
    toolFailures.set(key, entry);
  }
  if (toolFailures.size > 0)
    lines.push(
      "## Tools that failed",
      ...[...toolFailures]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 12)
        .map(
          ([key, { count, detail }]) =>
            `- ${key} ×${count}${detail ? `: ${quote(detail, 140)}` : ""}`,
        ),
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
