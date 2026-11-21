import { randomUUID } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { channelSlugWithId } from "@/helpers/channel-slug";
import {
  emitChatMessageNotifications,
  persistChatHumanMentions,
} from "@/helpers/chat-human-mentions";
import { publishChatRoomMessageRealtimeById } from "@/helpers/chat-room-message-realtime";
import { computeNextRun } from "@/helpers/cron";
import { jsonInput } from "@/helpers/prisma-json";
import { sokoBotDisplayName } from "@/helpers/soko-bot-display-name";
import { databaseNow } from "@/lib/db/database-now";
import prisma from "@/lib/db/prisma";
import { runAsBackgroundWork } from "@/lib/evlog";
import { askSmallModel } from "@/lib/soko-bot/small-model";
import {
  formatStandup,
  handoffMessage,
  lineIsEmpty,
  STANDUP_METADATA_KEY,
  STANDUP_ROOM_NAME,
  type StandupAgent,
  type StandupLine,
  type StandupMatch,
} from "@/lib/team-standup/standup-text";

/**
 * The organization's daily agent stand-up (one per organization, one host).
 * Core writes each agent's line from records (receipts and Task states),
 * never from what an agent claims, and wakes nobody to do it. One small model
 * call writes the summary line and proposes up to three matches; each match
 * opens a hand-off in the thread from the agent that needs something to the
 * one working on it, which only asks. Nothing new means nothing is posted.
 */

const MAX_MATCHES = 3;
/** What one hand-off may cost: the other agent's answer. */
const HANDOFF_ESTIMATE_USD_MICROS = 20_000;
const LOOKBACK_MS = 24 * 60 * 60_000;
const ACTIVE = ["READY", "QUEUED", "RUNNING", "AWAITING_EXTERNAL"] as const;
const WAITING_ON_PERSON = [
  "INPUT_REQUIRED",
  "APPROVAL_REQUIRED",
  "AUTHENTICATION_REQUIRED",
  "OUT_OF_CREDITS",
] as const;
/** Work a bot did that the organization can see: Tasks, posts, Files, tables. */
const SHARED_WORK: Record<string, [string, string]> = {
  create_task: ["Task created", "Tasks created"],
  assign_task: ["Task assigned", "Tasks assigned"],
  reply_to_task: ["Task answered", "Tasks answered"],
  create_social_post: ["post drafted", "posts drafted"],
  schedule_social_post: ["post scheduled", "posts scheduled"],
  publish_social_post: ["post published", "posts published"],
  upload_file: ["file saved", "files saved"],
  create_table: ["table made", "tables made"],
};

export function standupCron(standup: {
  timeOfDay: string;
  weekdays: number[];
}): string {
  const [hour, minute] = standup.timeOfDay.split(":").map(Number);
  const days = standup.weekdays.map((day) => day % 7).join(",");
  return `${minute ?? 0} ${hour ?? 9} * * ${days || "1-5"}`;
}

export function nextStandupAt(
  standup: { timeOfDay: string; weekdays: number[]; timezone: string },
  from: Date,
): Date | null {
  return computeNextRun({
    cron: standupCron(standup),
    timezone: standup.timezone,
    from,
  });
}

async function workspaceOf(organizationId: string) {
  return prisma.workspace.findFirst({
    where: { organizationId },
    select: { id: true },
  });
}

function countLabels(capabilities: string[]): string[] {
  const counts = new Map<string, number>();
  for (const capability of capabilities)
    if (SHARED_WORK[capability])
      counts.set(capability, (counts.get(capability) ?? 0) + 1);
  return [...counts].map(([capability, count]) => {
    const [one, many] = SHARED_WORK[capability]!;
    return `${count} ${count === 1 ? one : many}`;
  });
}

/** Every participating agent's line, from records only. */
export async function collectStandupLines(input: {
  workspaceId: string;
  since: Date;
  until: Date;
}): Promise<StandupLine[]> {
  const { workspaceId, since, until } = input;
  const bots = await prisma.sokoBot.findMany({
    where: {
      workspaceId,
      joinsTeamStandup: true,
      archivedAt: null,
      projectId: null,
    },
    select: {
      id: true,
      name: true,
      userId: true,
      user: { select: { id: true, name: true } },
    },
  });
  const lines: StandupLine[] = [];
  for (const bot of bots) {
    const agent: StandupAgent = {
      kind: "sokoBot",
      id: bot.id,
      name: sokoBotDisplayName({ name: bot.name }),
      ownerName: bot.user?.name ?? null,
    };
    const receipts = await prisma.sokoBotToolCall.findMany({
      where: {
        status: "COMPLETED",
        capability: { in: Object.keys(SHARED_WORK) },
        committedAt: { gte: since, lt: until },
        turn: { sokoBotId: bot.id },
      },
      select: { capability: true },
    });
    const delegated = await prisma.task.findMany({
      where: {
        workspaceId,
        visibility: "PUBLIC",
        archivedAt: null,
        status: { in: [...WAITING_ON_PERSON, "FAILED"] },
        sokoBotDelegations: { some: { turn: { sokoBotId: bot.id } } },
      },
      take: 5,
      select: { name: true, status: true },
    });
    const owner = bot.user;
    const open = owner
      ? await prisma.task.findMany({
          where: {
            workspaceId,
            visibility: "PUBLIC",
            archivedAt: null,
            ownerId: owner.id,
            assigneeId: null,
            assigneeUserId: null,
            assigneeSokoBotId: null,
            status: { in: ["DRAFT", "READY"] },
            createdAt: { gte: new Date(since.getTime() - 13 * LOOKBACK_MS) },
          },
          take: 3,
          select: { name: true },
        })
      : [];
    lines.push({
      agent,
      done: countLabels(receipts.map((receipt) => receipt.capability)),
      today: open.map((task) => `"${task.name}" (nobody has it yet)`),
      blocked: delegated.map((task) => ({
        what: `"${task.name}" ${task.status === "FAILED" ? "failed" : "waits for an answer"}`,
        waitsOn:
          task.status !== "FAILED" && owner
            ? { userId: owner.id, name: owner.name }
            : null,
      })),
    });
  }

  const tasks = await prisma.task.findMany({
    where: {
      workspaceId,
      visibility: "PUBLIC",
      archivedAt: null,
      assigneeId: { not: null },
      OR: [
        { status: { in: [...ACTIVE, ...WAITING_ON_PERSON] } },
        { status: "COMPLETED", updatedAt: { gte: since, lt: until } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: 60,
    select: {
      name: true,
      status: true,
      assignee: { select: { id: true, name: true } },
      owner: { select: { id: true, name: true } },
    },
  });
  const coworkers = new Map<string, StandupLine>();
  for (const task of tasks) {
    if (!task.assignee) continue;
    const line =
      coworkers.get(task.assignee.id) ??
      ({
        agent: {
          kind: "coworker",
          id: task.assignee.id,
          name: task.assignee.name,
          ownerName: null,
        },
        done: [],
        today: [],
        blocked: [],
      } satisfies StandupLine);
    coworkers.set(task.assignee.id, line);
    if (task.status === "COMPLETED") line.done.push(`"${task.name}"`);
    else if ((ACTIVE as readonly string[]).includes(task.status))
      line.today.push(`"${task.name}"`);
    else
      line.blocked.push({
        what: `"${task.name}" waits for an answer`,
        waitsOn: task.owner
          ? { userId: task.owner.id, name: task.owner.name }
          : null,
      });
  }
  return [...lines, ...coworkers.values()].filter((line) => !lineIsEmpty(line));
}

/** Open needs the host may match: unassigned Tasks of the participating bots' owners. */
async function openNeeds(
  workspaceId: string,
  bots: { id: string; ownerId: string | null }[],
  since: Date,
) {
  const owners = new Map(
    bots.flatMap((bot) =>
      bot.ownerId ? [[bot.ownerId, bot.id] as const] : [],
    ),
  );
  if (owners.size === 0) return [];
  const tasks = await prisma.task.findMany({
    where: {
      workspaceId,
      visibility: "PUBLIC",
      archivedAt: null,
      assigneeId: null,
      assigneeUserId: null,
      assigneeSokoBotId: null,
      status: { in: ["DRAFT", "READY"] },
      ownerId: { in: [...owners.keys()] },
      createdAt: { gte: new Date(since.getTime() - 13 * LOOKBACK_MS) },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { name: true, description: true, ownerId: true },
  });
  return tasks.map((task) => ({
    agentId: owners.get(task.ownerId ?? "") ?? "",
    need: task.name,
    detail: (task.description ?? "").slice(0, 300),
  }));
}

/** What the agents with a line are working on, with each Task's description. */
async function workInProgress(workspaceId: string, coworkerIds: string[]) {
  if (coworkerIds.length === 0) return [];
  const tasks = await prisma.task.findMany({
    where: {
      workspaceId,
      visibility: "PUBLIC",
      archivedAt: null,
      assigneeId: { in: coworkerIds },
      status: { in: [...ACTIVE, ...WAITING_ON_PERSON, "COMPLETED"] },
    },
    orderBy: { updatedAt: "desc" },
    take: 20,
    select: { name: true, description: true, assigneeId: true, status: true },
  });
  return tasks.map((task) => ({
    agentId: task.assigneeId ?? "",
    task: task.name,
    status: task.status,
    detail: (task.description ?? "").slice(0, 300),
  }));
}

const hostSchema = z.object({
  summary: z.string(),
  matches: z
    .array(
      z.object({
        needingAgentId: z.string(),
        offeringAgentId: z.string(),
        need: z.string(),
        offer: z.string(),
        askedFor: z.string(),
      }),
    )
    .max(MAX_MATCHES),
});

const HOST_SYSTEM = `You host a team's daily stand-up of AI agents. You get each agent's line (written from records, so it is true) and the open needs some agents have.
1. Write one summary line under 25 words: what was done, what waits on a person, what slipped. Facts from the lines only; no praise, no advice.
2. Propose at most three matches: an open need of one agent where another agent's work in progress or done would help, because it is about the same market, product, customer or deliverable (research on the DACH market helps a DACH market study). Sharing what they have is the whole ask, so a strong overlap is enough; it need not be the same task. needingAgentId is the agent with the need (it must be a Soko Bot), offeringAgentId the agent working on it. need is a short phrase ("a DACH market study"), offer says what the other does ("is researching that market"), askedFor is one plain question asking them to share what they have. No match when the overlap is not clear; an empty list is the usual answer.`;

export async function hostStandup(input: {
  lines: StandupLine[];
  needs: Awaited<ReturnType<typeof openNeeds>>;
  work: Awaited<ReturnType<typeof workInProgress>>;
}) {
  const agents = new Map(
    input.lines.map((line) => [line.agent.id, line.agent]),
  );
  const { output, costUsd } = await askSmallModel({
    purpose: "soko-bot",
    system: HOST_SYSTEM,
    prompt: JSON.stringify({
      lines: input.lines.map((line) => ({
        agentId: line.agent.id,
        kind: line.agent.kind,
        name: line.agent.name,
        done: line.done,
        today: line.today,
        blocked: line.blocked.map((blocker) => blocker.what),
      })),
      openNeeds: input.needs,
      workInProgress: input.work,
    }),
    schema: hostSchema,
  });
  const matches = output.matches.filter(
    (match) =>
      match.needingAgentId !== match.offeringAgentId &&
      agents.get(match.needingAgentId)?.kind === "sokoBot" &&
      agents.has(match.offeringAgentId),
  );
  return { summary: output.summary, matches, costUsd };
}

async function ensureStandupRoom(standup: {
  id: string;
  organizationId: string;
  roomId: string | null;
}): Promise<string> {
  if (standup.roomId) {
    const room = await prisma.chatRoom.findFirst({
      where: { id: standup.roomId, archivedAt: null },
      select: { id: true },
    });
    if (room) return room.id;
  }
  const owner = await prisma.member.findFirst({
    where: { organizationId: standup.organizationId, role: "owner" },
    orderBy: { createdAt: "asc" },
    select: { userId: true },
  });
  if (!owner) throw new Error("The organization has no owner");
  const room = await prisma.chatRoom.create({
    data: {
      organizationId: standup.organizationId,
      createdByUserId: owner.userId,
      name: STANDUP_ROOM_NAME,
      slug: channelSlugWithId(STANDUP_ROOM_NAME, randomUUID(), "stand-up"),
      discoverability: "public",
      userMembers: { create: [{ userId: owner.userId, access: "member" }] },
    },
    select: { id: true },
  });
  await prisma.teamStandup.update({
    where: { id: standup.id },
    data: { roomId: room.id },
  });
  return room.id;
}

/** Everyone the thread names is in the room: agents to answer there, people to be mentioned. */
async function seatParticipants(
  roomId: string,
  lines: StandupLine[],
): Promise<void> {
  for (const line of lines) {
    if (line.agent.kind === "sokoBot")
      await prisma.chatRoomSokoBotMember.upsert({
        where: { roomId_sokoBotId: { roomId, sokoBotId: line.agent.id } },
        create: { roomId, sokoBotId: line.agent.id },
        update: {},
      });
    else
      await prisma.chatRoomCoworkerMember.upsert({
        where: { roomId_coworkerId: { roomId, coworkerId: line.agent.id } },
        create: { roomId, coworkerId: line.agent.id },
        update: {},
      });
    for (const blocker of line.blocked)
      if (blocker.waitsOn)
        await prisma.chatRoomUserMember.upsert({
          where: { roomId_userId: { roomId, userId: blocker.waitsOn.userId } },
          create: { roomId, userId: blocker.waitsOn.userId, access: "member" },
          update: {},
        });
  }
}

async function openHandoff(input: {
  roomId: string;
  rootId: string;
  match: StandupMatch & { askedFor: string };
  lines: StandupLine[];
}): Promise<string | null> {
  const offering = input.lines.find(
    (line) => line.agent.id === input.match.offeringAgentId,
  )?.agent;
  if (!offering) return null;
  const handle =
    offering.kind === "coworker"
      ? (
          await prisma.coworker.findUniqueOrThrow({
            where: { id: offering.id },
            select: { slug: true },
          })
        ).slug
      : offering.name;
  const message = await prisma.chatRoomMessage.create({
    data: {
      roomId: input.roomId,
      parentMessageId: input.rootId,
      senderSokoBotId: input.match.needingAgentId,
      content: handoffMessage({
        offeringHandle: handle,
        need: input.match.need,
        context: `${offering.name} ${input.match.offer}.`,
        askedFor: input.match.askedFor,
      }),
      metadata: jsonInput({ [STANDUP_METADATA_KEY]: { handoff: true } }),
    },
    select: { id: true },
  });
  // One hop: the answer is posted, and nobody it reaches may wake a third agent.
  const mention = await prisma.chatRoomMention.create({
    data: {
      messageId: message.id,
      coworkerId: offering.kind === "coworker" ? offering.id : null,
      sokoBotId: offering.kind === "sokoBot" ? offering.id : null,
      chainDepth: 1,
      status: "pending",
    },
    select: { id: true },
  });
  await publishChatRoomMessageRealtimeById(message.id, "create");
  return mention.id;
}

export interface StandupRunOutcome {
  status: "POSTED" | "QUIET" | "FAILED";
  runId: string;
  messageId: string | null;
  mentionIds: string[];
}

/** One stand-up for one slot; the run row makes it happen once. */
export async function runTeamStandup(input: {
  standupId: string;
  scheduledFor: Date;
  dispatch?: (mentionId: string) => Promise<void>;
  /** Tests stand in for the model; every real run asks it. */
  host?: typeof hostStandup;
}): Promise<StandupRunOutcome | null> {
  const standup = await prisma.teamStandup.findUniqueOrThrow({
    where: { id: input.standupId },
  });
  const created = await prisma.teamStandupRun
    .create({
      data: {
        standupId: standup.id,
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
    const previous = await prisma.teamStandupRun.findFirst({
      where: {
        standupId: standup.id,
        id: { not: runId },
        status: { in: ["POSTED", "QUIET"] },
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    const since =
      previous?.createdAt ?? new Date(until.getTime() - LOOKBACK_MS);
    const lines = await collectStandupLines({
      workspaceId: workspace.id,
      since,
      until,
    });
    if (lines.length === 0) {
      await prisma.teamStandupRun.update({
        where: { id: runId },
        data: { status: "QUIET" },
      });
      return { status: "QUIET", runId, messageId: null, mentionIds: [] };
    }
    const participants = await prisma.sokoBot.findMany({
      where: {
        id: {
          in: lines
            .filter((line) => line.agent.kind === "sokoBot")
            .map((line) => line.agent.id),
        },
      },
      select: { id: true, userId: true },
    });
    const needs = await openNeeds(
      workspace.id,
      participants.map((bot) => ({ id: bot.id, ownerId: bot.userId })),
      since,
    );
    const work = await workInProgress(
      workspace.id,
      lines
        .filter((line) => line.agent.kind === "coworker")
        .map((line) => line.agent.id),
    );
    const host = await (input.host ?? hostStandup)({ lines, needs, work });
    const spentMicros = BigInt(Math.round(host.costUsd * 1e6));
    const affordable = Math.max(
      0,
      Math.floor(
        Number(standup.costCapUsdMicros - spentMicros) /
          HANDOFF_ESTIMATE_USD_MICROS,
      ),
    );
    const matches = host.matches.slice(0, Math.min(MAX_MATCHES, affordable));
    const roomId = await ensureStandupRoom(standup);
    await seatParticipants(roomId, lines);
    const date = new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: standup.timezone,
    }).format(input.scheduledFor);
    const content = formatStandup({
      date,
      lines,
      matches,
      summary: host.summary,
    });
    const root = await prisma.$transaction(async (tx) => {
      const message = await tx.chatRoomMessage.create({
        data: {
          roomId,
          content,
          metadata: jsonInput({ [STANDUP_METADATA_KEY]: { runId } }),
        },
        select: { id: true },
      });
      const mentioned = await persistChatHumanMentions(tx, {
        messageId: message.id,
        roomId,
        content,
      });
      await tx.chatRoom.update({
        where: { id: roomId },
        data: { updatedAt: new Date() },
      });
      return { id: message.id, mentioned };
    });
    await publishChatRoomMessageRealtimeById(root.id, "create");
    await emitChatMessageNotifications({
      messageId: root.id,
      mentionedUserIds: root.mentioned,
    });
    const mentionIds: string[] = [];
    for (const match of matches) {
      const mentionId = await openHandoff({
        roomId,
        rootId: root.id,
        match,
        lines,
      });
      if (mentionId) mentionIds.push(mentionId);
    }
    await prisma.teamStandupRun.update({
      where: { id: runId },
      data: {
        status: "POSTED",
        messageId: root.id,
        lines: jsonInput(lines),
        matches: jsonInput(matches),
        costUsdMicros: spentMicros,
      },
    });
    const dispatch =
      input.dispatch ??
      (async (mentionId: string) => {
        const { dispatchChatRoomMention } = await import(
          "@/services/chat-room-coworker-dispatch.service"
        );
        await dispatchChatRoomMention(mentionId);
      });
    for (const mentionId of mentionIds)
      waitUntil(runAsBackgroundWork(() => dispatch(mentionId)));
    return { status: "POSTED", runId, messageId: root.id, mentionIds };
  } catch (error) {
    await prisma.teamStandupRun.update({
      where: { id: runId },
      data: {
        status: "FAILED",
        error: error instanceof Error ? error.message.slice(0, 500) : "failed",
      },
    });
    return { status: "FAILED", runId, messageId: null, mentionIds: [] };
  }
}

/** Platform switch: admins pause every stand-up at once (Soko Bot settings). */
async function standupsPaused(): Promise<boolean> {
  const setting = await prisma.sokoBotSetting.findUnique({
    where: { id: "singleton" },
    select: { disabledAt: true, standupPausedAt: true },
  });
  return Boolean(setting?.disabledAt || setting?.standupPausedAt);
}

/** Every minute, from the Soko Bot events cron: the stand-ups that are due. */
export async function syncTeamStandups(input: {
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
    where: { enabled: true, nextRunAt: { lte: now } },
    take: 20,
    select: {
      id: true,
      nextRunAt: true,
      timeOfDay: true,
      weekdays: true,
      timezone: true,
    },
  });
  for (const standup of due) {
    if (!input.shouldContinue()) break;
    result.checked += 1;
    await prisma.teamStandup.update({
      where: { id: standup.id },
      data: { nextRunAt: nextStandupAt(standup, now), lastRunAt: now },
    });
    const outcome = await runTeamStandup({
      standupId: standup.id,
      scheduledFor: standup.nextRunAt!,
    });
    if (outcome?.status === "POSTED") result.posted += 1;
    else if (outcome?.status === "QUIET") result.quiet += 1;
    else if (outcome?.status === "FAILED") result.failed += 1;
  }
  return result;
}
