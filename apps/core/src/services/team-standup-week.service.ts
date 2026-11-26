import type { Prisma } from "@sokosumi/database";
import { z } from "zod";
import { publishChatRoomMessageRealtimeById } from "@/helpers/chat-room-message-realtime";
import { jsonInput } from "@/helpers/prisma-json";
import { databaseNow } from "@/lib/db/database-now";
import prisma from "@/lib/db/prisma";
import { askSmallModel } from "@/lib/soko-bot/small-model";
import {
  type AgentWeek,
  formatWeekInReview,
  type PersonWeek,
  personWeekParts,
  recordDone,
  STANDUP_METADATA_KEY,
} from "@/lib/team-standup/standup-text";
import {
  collectAgentRecords,
  ensureStandupRoom,
  nextStandupAt,
  standupsPaused,
  workspaceOf,
} from "@/services/team-standup.service";

/**
 * Week in review: once a week, in the Stand-up channel, one line per person
 * and per agent. A person's line is counted from records they made in places
 * the whole organization sees (public Tasks, approvals, posts, shared files
 * and tables), never from mail, calendars, direct messages or private Tasks,
 * and never from what anything says: names and counts only. People who turned
 * off "Include my week in the stand-up" get no line. One small model call
 * writes the summary line. Nothing new means nothing is posted.
 */

const WEEK_MS = 7 * 24 * 60 * 60_000;

function emptyWeek(userId: string, name: string): PersonWeek {
  return {
    userId,
    name,
    finished: [],
    answered: 0,
    assigned: 0,
    approved: { strategies: 0, newsletters: 0 },
    postsPublished: 0,
    filesShared: 0,
    tablesMade: 0,
  };
}

/** Every included member's week, from records only; people with nothing get no line. */
export async function collectPeopleWeek(input: {
  organizationId: string;
  workspaceId: string;
  since: Date;
  until: Date;
}): Promise<PersonWeek[]> {
  const { organizationId, workspaceId, since, until } = input;
  const window = { gte: since, lt: until };
  const members = await prisma.member.findMany({
    where: { organizationId, user: { hideWeekFromStandup: false } },
    orderBy: { createdAt: "asc" },
    select: { user: { select: { id: true, name: true } } },
  });
  const weeks = new Map(
    members.map(({ user }) => [user.id, emptyWeek(user.id, user.name)]),
  );
  const userIds = [...weeks.keys()];
  if (userIds.length === 0) return [];
  const publicTask = {
    workspaceId,
    visibility: "PUBLIC",
    archivedAt: null,
  } satisfies Prisma.TaskWhereInput;

  const [
    completions,
    completedAssigned,
    comments,
    handedOut,
    strategies,
    newsletters,
    posts,
    shares,
    taskFiles,
    tables,
  ] = await Promise.all([
    prisma.taskEvent.findMany({
      where: {
        userId: { in: userIds },
        status: "COMPLETED",
        createdAt: window,
        task: { ...publicTask, status: "COMPLETED" },
      },
      select: { userId: true, task: { select: { id: true, name: true } } },
    }),
    prisma.task.findMany({
      where: {
        ...publicTask,
        assigneeUserId: { in: userIds },
        status: "COMPLETED",
        updatedAt: window,
      },
      select: { id: true, name: true, assigneeUserId: true },
    }),
    prisma.taskEvent.findMany({
      where: {
        userId: { in: userIds },
        comment: { not: null },
        createdAt: window,
        task: publicTask,
      },
      distinct: ["userId", "taskId"],
      select: { userId: true },
    }),
    prisma.task.findMany({
      where: {
        ...publicTask,
        creatorUserId: { in: userIds },
        createdAt: window,
        OR: [
          { assigneeId: { not: null } },
          { assigneeSokoBotId: { not: null } },
          { assigneeUserId: { not: null } },
        ],
      },
      select: { creatorUserId: true },
    }),
    prisma.marketingStrategy.findMany({
      where: {
        approvedByUserId: { in: userIds },
        approvedAt: window,
        project: { workspaceId },
      },
      select: { approvedByUserId: true },
    }),
    prisma.newsletterIssue.findMany({
      where: {
        workspaceId,
        approvedByUserId: { in: userIds },
        approvedAt: window,
      },
      select: { approvedByUserId: true },
    }),
    prisma.socialPost.findMany({
      where: {
        workspaceId,
        publishedAt: window,
        OR: [
          { scheduledByUserId: { in: userIds } },
          { scheduledByUserId: null, creatorUserId: { in: userIds } },
        ],
      },
      select: { scheduledByUserId: true, creatorUserId: true },
    }),
    prisma.driveShare.findMany({
      where: {
        workspaceId,
        sourceScope: "ORGANIZATION",
        createdByUserId: { in: userIds },
        createdAt: window,
      },
      select: { createdByUserId: true },
    }),
    prisma.taskFile.findMany({
      where: {
        uploadedByUserId: { in: userIds },
        createdAt: window,
        task: publicTask,
      },
      select: { uploadedByUserId: true },
    }),
    prisma.dataTable.findMany({
      where: {
        workspaceId,
        createdBy: { in: userIds },
        createdAt: window,
        archivedAt: null,
      },
      select: { createdBy: true },
    }),
  ]);

  const of = (userId: string | null) => (userId ? weeks.get(userId) : null);
  const finishedIds = new Map<string, Set<string>>();
  const finish = (
    userId: string | null,
    task: { id: string; name: string },
  ) => {
    const week = of(userId);
    if (!week || !userId) return;
    const seen = finishedIds.get(userId) ?? new Set<string>();
    finishedIds.set(userId, seen);
    if (seen.has(task.id)) return;
    seen.add(task.id);
    week.finished.push(task.name);
  };
  for (const event of completions) finish(event.userId, event.task);
  for (const task of completedAssigned) finish(task.assigneeUserId, task);
  for (const comment of comments) {
    const week = of(comment.userId);
    if (week) week.answered += 1;
  }
  for (const task of handedOut) {
    const week = of(task.creatorUserId);
    if (week) week.assigned += 1;
  }
  for (const strategy of strategies) {
    const week = of(strategy.approvedByUserId);
    if (week) week.approved.strategies += 1;
  }
  for (const issue of newsletters) {
    const week = of(issue.approvedByUserId);
    if (week) week.approved.newsletters += 1;
  }
  for (const post of posts) {
    const week = of(post.scheduledByUserId ?? post.creatorUserId);
    if (week) week.postsPublished += 1;
  }
  for (const share of shares) {
    const week = of(share.createdByUserId);
    if (week) week.filesShared += 1;
  }
  for (const file of taskFiles) {
    const week = of(file.uploadedByUserId);
    if (week) week.filesShared += 1;
  }
  for (const table of tables) {
    const week = of(table.createdBy);
    if (week) week.tablesMade += 1;
  }
  return [...weeks.values()].filter((week) => personWeekParts(week).length > 0);
}

/** What the participating agents got done in the week. */
async function collectAgentWeek(input: {
  workspaceId: string;
  since: Date;
  until: Date;
}): Promise<AgentWeek[]> {
  const records = await collectAgentRecords(input);
  return records
    .map((record) => ({ agent: record.agent, done: recordDone(record) }))
    .filter((line) => line.done.length > 0);
}

const WEEK_SYSTEM = `You write the one summary line under a team's weekly review. You get one line per person and per agent, counted from records, so they are true. Write one line under 30 words: what the team got done this week, in plain words. Facts from the lines only; no praise, no advice, no ranking of people.`;

export async function summarizeWeek(input: {
  people: PersonWeek[];
  agents: AgentWeek[];
}): Promise<{ summary: string; costUsd: number }> {
  const { output, costUsd } = await askSmallModel({
    label: "team-standup-week",
    purpose: "soko-bot",
    system: WEEK_SYSTEM,
    prompt: JSON.stringify({
      people: input.people.map((person) => ({
        name: person.name,
        did: personWeekParts(person),
      })),
      agents: input.agents.map((line) => ({
        name: line.agent.name,
        done: line.done,
      })),
    }),
    schema: z.object({ summary: z.string() }),
  });
  return { summary: output.summary, costUsd };
}

export interface WeekInReviewOutcome {
  status: "POSTED" | "QUIET" | "FAILED";
  runId: string;
  messageId: string | null;
}

/** One week in review for one slot; the run row makes it happen once. */
export async function runWeekInReview(input: {
  standupId: string;
  scheduledFor: Date;
  /** Tests stand in for the model; every real run asks it. */
  summarize?: typeof summarizeWeek;
}): Promise<WeekInReviewOutcome | null> {
  const standup = await prisma.teamStandup.findUniqueOrThrow({
    where: { id: input.standupId },
  });
  const created = await prisma.teamStandupRun
    .create({
      data: {
        standupId: standup.id,
        kind: "WEEKLY",
        scheduledFor: input.scheduledFor,
        status: "RUNNING",
      },
      select: { id: true },
    })
    .catch(() => null);
  if (!created) return null;
  const runId = created.id;
  try {
    const workspace = await workspaceOf(standup.organizationId);
    if (!workspace) throw new Error("The organization has no workspace");
    const until = await databaseNow();
    const since = new Date(until.getTime() - WEEK_MS);
    const window = { workspaceId: workspace.id, since, until };
    const people = await collectPeopleWeek({
      ...window,
      organizationId: standup.organizationId,
    });
    const agents = await collectAgentWeek(window);
    if (people.length === 0 && agents.length === 0) {
      await prisma.teamStandupRun.update({
        where: { id: runId },
        data: { status: "QUIET" },
      });
      return { status: "QUIET", runId, messageId: null };
    }
    const { summary, costUsd } = await (input.summarize ?? summarizeWeek)({
      people,
      agents,
    });
    const roomId = await ensureStandupRoom(standup);
    const day = (date: Date) =>
      new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        timeZone: standup.timezone,
      }).format(date);
    const content = formatWeekInReview({
      dates: `${day(since)} – ${day(new Date(until.getTime() - 1))}`,
      people,
      agents,
      summary,
    });
    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.chatRoomMessage.create({
        data: {
          roomId,
          content,
          metadata: jsonInput({ [STANDUP_METADATA_KEY]: { runId } }),
        },
        select: { id: true },
      });
      await tx.chatRoom.update({
        where: { id: roomId },
        data: { updatedAt: new Date() },
      });
      return created;
    });
    await publishChatRoomMessageRealtimeById(message.id, "create");
    await prisma.teamStandupRun.update({
      where: { id: runId },
      data: {
        status: "POSTED",
        messageId: message.id,
        lines: jsonInput({ people, agents }),
        costUsdMicros: BigInt(Math.round(costUsd * 1e6)),
      },
    });
    return { status: "POSTED", runId, messageId: message.id };
  } catch (error) {
    await prisma.teamStandupRun.update({
      where: { id: runId },
      data: {
        status: "FAILED",
        error: error instanceof Error ? error.message.slice(0, 500) : "failed",
      },
    });
    return { status: "FAILED", runId, messageId: null };
  }
}

export function nextWeekInReviewAt(
  standup: { timeOfDay: string; weekInReviewWeekday: number; timezone: string },
  from: Date,
): Date | null {
  return nextStandupAt(
    { ...standup, weekdays: [standup.weekInReviewWeekday] },
    from,
  );
}

/** Every minute, from the Soko Bot events cron: the weeks in review that are due. */
export async function syncWeekInReviews(input: {
  shouldContinue: () => boolean;
}): Promise<{
  checked: number;
  posted: number;
  quiet: number;
  failed: number;
}> {
  const result = { checked: 0, posted: 0, quiet: 0, failed: 0 };
  if (await standupsPaused()) return result;
  const now = await databaseNow();
  const due = await prisma.teamStandup.findMany({
    where: {
      enabled: true,
      OR: [
        { weekInReviewNextRunAt: null },
        { weekInReviewNextRunAt: { lte: now } },
      ],
    },
    take: 20,
    select: {
      id: true,
      weekInReviewNextRunAt: true,
      weekInReviewWeekday: true,
      timeOfDay: true,
      timezone: true,
    },
  });
  for (const standup of due) {
    if (!input.shouldContinue()) break;
    await prisma.teamStandup.update({
      where: { id: standup.id },
      data: { weekInReviewNextRunAt: nextWeekInReviewAt(standup, now) },
    });
    // A stand-up from before week in review existed gets its first slot here.
    if (!standup.weekInReviewNextRunAt) continue;
    result.checked += 1;
    const outcome = await runWeekInReview({
      standupId: standup.id,
      scheduledFor: standup.weekInReviewNextRunAt,
    });
    if (outcome?.status === "POSTED") result.posted += 1;
    else if (outcome?.status === "QUIET") result.quiet += 1;
    else if (outcome?.status === "FAILED") result.failed += 1;
  }
  return result;
}
