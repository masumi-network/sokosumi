import { randomUUID } from "node:crypto";
import { hideSeoAuditRequest } from "@sokosumi/utils";
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
import { recordCoreWarning, runAsBackgroundWork } from "@/lib/evlog";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import { standupClaimsUnrecordedWork } from "@/lib/soko-bot/answer-claims";
import { askSmallModel } from "@/lib/soko-bot/small-model";
import {
  type AgentRecord,
  botFallbackMessage,
  coworkerStandupMessage,
  emptyRecord,
  handoffMessage,
  mentionToken,
  peopleWaitedOn,
  recordIsEmpty,
  STANDUP_METADATA_KEY,
  STANDUP_ROOM_NAME,
  type StandupMatch,
  shortTitleByRules,
  standupOpener,
  withMentions,
} from "@/lib/team-standup/standup-text";
import { proactiveGate } from "@/services/soko-bot-proactive.service";

/**
 * The organization's daily agent stand-up (one per organization). Core reads
 * each agent's record (receipts and public Task states), never what an agent
 * claims. After a short opener every agent posts its own message: a Soko Bot
 * writes it in its own words with one small model call and no tools, checked
 * against its record (its record is posted instead when the check fails); a
 * Coworker, which only reads Task text, gets one plain line Core writes under
 * its name. One more small call proposes up to three matches; each opens a
 * hand-off under the needing bot's message to the agent working on it, which
 * only asks. Nothing new means nothing is posted.
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

export async function workspaceOf(organizationId: string) {
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

const TASK_WORK: Record<string, string> = {
  create_task: "created",
  assign_task: "handed out",
  reply_to_task: "answered",
};

/** At most this many agents post per stand-up: a room takes 20 agent messages an hour. */
const MAX_AGENT_MESSAGES = 12;

/** Every participating agent's record, from receipts and public Task states only. */
export async function collectAgentRecords(input: {
  workspaceId: string;
  since: Date;
  until: Date;
}): Promise<AgentRecord[]> {
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
      user: { select: { id: true, name: true } },
    },
  });
  const records: AgentRecord[] = [];
  /** Tasks a participating bot handed out: the bot reports the wait, so the Coworker does not ping the same person again. */
  const spokenFor = new Set<string>();
  for (const bot of bots) {
    const record = emptyRecord({
      kind: "sokoBot",
      id: bot.id,
      name: sokoBotDisplayName({ name: bot.name }),
      ownerName: bot.user?.name ?? null,
    });
    const receipts = await prisma.sokoBotToolCall.findMany({
      where: {
        status: "COMPLETED",
        capability: { in: Object.keys(SHARED_WORK) },
        committedAt: { gte: since, lt: until },
        turn: { sokoBotId: bot.id },
      },
      select: { capability: true, targetId: true },
    });
    record.counts = countLabels(receipts.map((receipt) => receipt.capability));
    const touchedIds = receipts.flatMap((receipt) =>
      TASK_WORK[receipt.capability] && receipt.targetId
        ? [receipt.targetId]
        : [],
    );
    const touched = touchedIds.length
      ? await prisma.task.findMany({
          where: {
            id: { in: touchedIds },
            workspaceId,
            visibility: "PUBLIC",
            archivedAt: null,
          },
          select: { id: true, name: true },
        })
      : [];
    const names = new Map(touched.map((task) => [task.id, task.name]));
    record.touched = [
      ...new Set(
        receipts.flatMap((receipt) => {
          const name = receipt.targetId ? names.get(receipt.targetId) : null;
          const verb = TASK_WORK[receipt.capability];
          return name && verb ? [`${verb} "${name}"`] : [];
        }),
      ),
    ];
    const handedOut = await prisma.task.findMany({
      where: {
        workspaceId,
        visibility: "PUBLIC",
        archivedAt: null,
        status: { in: [...ACTIVE, ...WAITING_ON_PERSON, "FAILED"] },
        sokoBotDelegations: { some: { turn: { sokoBotId: bot.id } } },
      },
      orderBy: { updatedAt: "desc" },
      take: 8,
      select: { id: true, name: true, status: true },
    });
    const owner = bot.user;
    for (const task of handedOut) {
      spokenFor.add(task.id);
      if ((ACTIVE as readonly string[]).includes(task.status))
        record.working.push(task.name);
      else
        record.waiting.push({
          task: task.name,
          failed: task.status === "FAILED",
          waitsOn:
            task.status !== "FAILED" && owner
              ? { userId: owner.id, name: owner.name }
              : null,
        });
    }
    record.working = record.working.slice(0, 3);
    record.waiting = record.waiting.slice(0, 5);
    if (owner)
      record.open = (
        await prisma.task.findMany({
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
      ).map((task) => task.name);
    records.push(record);
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
      id: true,
      name: true,
      status: true,
      assignee: { select: { id: true, name: true } },
      owner: { select: { id: true, name: true } },
    },
  });
  const coworkers = new Map<string, AgentRecord>();
  for (const task of tasks) {
    if (!task.assignee) continue;
    const record =
      coworkers.get(task.assignee.id) ??
      emptyRecord({
        kind: "coworker",
        id: task.assignee.id,
        name: task.assignee.name,
        ownerName: null,
      });
    coworkers.set(task.assignee.id, record);
    if (task.status === "COMPLETED") record.finished.push(task.name);
    else if ((ACTIVE as readonly string[]).includes(task.status))
      record.working.push(task.name);
    else if (!spokenFor.has(task.id))
      record.waiting.push({
        task: task.name,
        failed: false,
        waitsOn: task.owner
          ? { userId: task.owner.id, name: task.owner.name }
          : null,
      });
  }
  return [...records, ...coworkers.values()].filter(
    (record) => !recordIsEmpty(record),
  );
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
    detail: (hideSeoAuditRequest(task.description) ?? "").slice(0, 300),
  }));
}

/** What the agents with a record are working on, with each Task's description. */
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
    detail: (hideSeoAuditRequest(task.description) ?? "").slice(0, 300),
  }));
}

const hostSchema = z.object({
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

const HOST_SYSTEM = `You host a team's daily stand-up of AI agents. You get each agent's record (from receipts and Task states, so it is true) and the open needs some agents have.
Propose at most three matches: an open need of one agent where another agent's work in progress or done would help, because it is about the same market, product, customer or deliverable (research on the DACH market helps a DACH market study). Sharing what they have is the whole ask, so a strong overlap is enough; it need not be the same task. needingAgentId is the agent with the need (it must be a Soko Bot), offeringAgentId the agent working on it. need is a short phrase ("a DACH market study"), offer says what the other does ("is researching that market"), askedFor is one plain question asking them to share what they have. No match when the overlap is not clear; an empty list is the usual answer.`;

function recordFacts(record: AgentRecord) {
  return {
    did: [...record.counts, ...record.touched],
    finished: record.finished,
    working: record.working,
    open: record.open,
    waiting: record.waiting.map(
      (wait) =>
        `${wait.task}: ${wait.failed ? "failed" : wait.waitsOn ? `waits on ${wait.waitsOn.name}` : "waits for an answer"}`,
    ),
  };
}

export async function hostStandup(input: {
  records: AgentRecord[];
  needs: Awaited<ReturnType<typeof openNeeds>>;
  work: Awaited<ReturnType<typeof workInProgress>>;
}) {
  const agents = new Map(
    input.records.map((record) => [record.agent.id, record.agent]),
  );
  if (input.needs.length === 0) return { matches: [], costUsd: 0 };
  const { output, costUsd } = await askSmallModel({
    purpose: "soko-bot",
    system: HOST_SYSTEM,
    prompt: JSON.stringify({
      agents: input.records.map((record) => ({
        agentId: record.agent.id,
        kind: record.agent.kind,
        name: record.agent.name,
        ...recordFacts(record),
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
  return { matches, costUsd };
}

const BOT_SYSTEM = `You are an AI assistant posting your own update in your team's daily stand-up channel, like a teammate would. You get your record since the last stand-up; it is all you know.
Record: did = what your receipts show you did; finished = Tasks finished; working = Tasks you handed out that are still running; open = Tasks on your owner's list nobody has taken yet (call them open or unassigned, never yours or next for you); waiting = Tasks waiting on a person or failed.
Write 2 to 4 short lines in the first person, in plain everyday words: what you did, what is still running, what is blocking you, and who you need something from. Facts from the record only: never add work, numbers, names or Tasks it does not have, and never promise to start something new. Shorten long Task names. When you need something from a person, write their mention token exactly as given (like @abc123) instead of their name. No greeting, heading, bullet list, emoji, praise or sign-off. If the record has nothing done, say so in a few words.`;

const BOT_MESSAGE_MAX_CHARS = 700;

/** Numbers and mention tokens the text may use: only those in the record. */
function onlyRecordedTokens(text: string, record: AgentRecord): boolean {
  const facts = JSON.stringify(recordFacts(record));
  const people = new Set(
    record.waiting.flatMap((wait) =>
      wait.waitsOn ? [mentionToken(wait.waitsOn)] : [],
    ),
  );
  const mentions = /@[^\s:,.!?;()[\]{}]+/g;
  return (
    (text.match(mentions) ?? []).every((token) => people.has(token)) &&
    (text.replace(mentions, "").match(/\d+/g) ?? []).every((digits) =>
      facts.includes(digits),
    )
  );
}

export interface BotUpdate {
  text: string;
  /** "own": the bot's words, checked; "record": its record, because its words could not be shown. */
  source: "own" | "record";
  costUsd: number;
}

export function botUpdatePrompt(record: AgentRecord) {
  return {
    system: BOT_SYSTEM,
    prompt: JSON.stringify({
      you: record.agent.name,
      owner: record.agent.ownerName,
      ...recordFacts(record),
      mentionTokens: Object.fromEntries(
        peopleWaitedOn(record).map((person) => [
          person.name,
          mentionToken(person),
        ]),
      ),
    }),
  };
}

/** One bot's stand-up message: one small model call with no tools, then the claim check. */
export async function writeBotUpdate(record: AgentRecord): Promise<BotUpdate> {
  const facts = recordFacts(record);
  const fallback = (costUsd: number): BotUpdate => ({
    text: botFallbackMessage(record),
    source: "record",
    costUsd,
  });
  let costUsd = 0;
  try {
    const answer = await askSmallModel({
      purpose: "soko-bot",
      ...botUpdatePrompt(record),
      schema: z.object({ message: z.string() }),
    });
    costUsd = answer.costUsd;
    const text = answer.output.message.trim();
    if (
      !text ||
      text.length > BOT_MESSAGE_MAX_CHARS ||
      text.split("\n").filter(Boolean).length > 5 ||
      !onlyRecordedTokens(text, record)
    )
      return fallback(costUsd);
    const recorded = [
      ...facts.did.map((item) => `did: ${item}`),
      ...facts.finished.map((item) => `finished: ${item}`),
      ...facts.working.map((item) => `running: ${item}`),
      ...facts.open.map((item) => `open, nobody has it: ${item}`),
      ...facts.waiting.map((item) => `waiting: ${item}`),
    ];
    if ((await standupClaimsUnrecordedWork(text, recorded)) !== false)
      return fallback(costUsd);
    return {
      text: withMentions(text, peopleWaitedOn(record)),
      source: "own",
      costUsd,
    };
  } catch (error) {
    recordCoreWarning(
      { operation: "team_standup_bot_update" },
      {
        message: "A Soko Bot's stand-up update fell back to its record",
        why: "The small model failed",
        fix: "Nothing: the record is posted under the bot's name instead.",
      },
      { failure: messageSafeErrorFields(error) },
    );
    return fallback(costUsd);
  }
}

const SHORT_SYSTEM = `You shorten Task titles for a team's stand-up channel. For each title write a short plain phrase of at most 6 words a busy reader gets at once ("Weekly Competitor Intelligence — Top 3 Launches, Pricing & Market Gaps" → "competitor report"; "Daily X engagement opportunities: Tech Startup AI — 2026-11-23" → "X engagement ideas"). Keep the title's language and its subject; drop dates, run numbers, prefixes and brackets. Lower-case unless a word is a name. Never add anything the title does not say.`;

export async function shortenTitles(
  titles: string[],
): Promise<{ short: Map<string, string>; costUsd: number }> {
  const unique = [...new Set(titles)];
  const short = new Map(
    unique.map((title) => [title, shortTitleByRules(title)]),
  );
  if (unique.length === 0) return { short, costUsd: 0 };
  try {
    const { output, costUsd } = await askSmallModel({
      purpose: "soko-bot",
      system: SHORT_SYSTEM,
      prompt: JSON.stringify({ titles: unique }),
      schema: z.object({
        short: z.array(z.object({ title: z.string(), short: z.string() })),
      }),
    });
    for (const { title, short: phrase } of output.short) {
      const clean = phrase.trim();
      const digitsKept = (clean.match(/\d+/g) ?? []).every((digits) =>
        title.includes(digits),
      );
      if (short.has(title) && clean && clean.length <= 60 && digitsKept)
        short.set(title, clean);
    }
    return { short, costUsd };
  } catch {
    return { short, costUsd: 0 };
  }
}

export async function ensureStandupRoom(standup: {
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

/** Everyone the stand-up names is in the room: agents to post and answer there, people to be mentioned. */
async function seatParticipants(
  roomId: string,
  records: AgentRecord[],
): Promise<void> {
  for (const record of records) {
    if (record.agent.kind === "sokoBot")
      await prisma.chatRoomSokoBotMember.upsert({
        where: { roomId_sokoBotId: { roomId, sokoBotId: record.agent.id } },
        create: { roomId, sokoBotId: record.agent.id },
        update: {},
      });
    else
      await prisma.chatRoomCoworkerMember.upsert({
        where: { roomId_coworkerId: { roomId, coworkerId: record.agent.id } },
        create: { roomId, coworkerId: record.agent.id },
        update: {},
      });
    for (const person of peopleWaitedOn(record))
      await prisma.chatRoomUserMember.upsert({
        where: { roomId_userId: { roomId, userId: person.userId } },
        create: { roomId, userId: person.userId, access: "member" },
        update: {},
      });
  }
}

/** Posts one stand-up message, mentions included, and tells the room. */
async function postStandupMessage(input: {
  roomId: string;
  runId: string;
  content: string;
  sender?: { kind: AgentRecord["agent"]["kind"]; id: string };
}): Promise<string> {
  const { roomId, content, sender } = input;
  const posted = await prisma.$transaction(async (tx) => {
    const message = await tx.chatRoomMessage.create({
      data: {
        roomId,
        content,
        senderSokoBotId: sender?.kind === "sokoBot" ? sender.id : null,
        senderCoworkerId: sender?.kind === "coworker" ? sender.id : null,
        metadata: jsonInput({
          [STANDUP_METADATA_KEY]: {
            runId: input.runId,
            ...(sender ? { agentId: sender.id } : {}),
          },
        }),
      },
      select: { id: true },
    });
    const mentioned = await persistChatHumanMentions(tx, {
      messageId: message.id,
      roomId,
      content,
      expandAll: false,
    });
    await tx.chatRoom.update({
      where: { id: roomId },
      data: { updatedAt: new Date() },
    });
    return { id: message.id, mentioned };
  });
  await publishChatRoomMessageRealtimeById(posted.id, "create");
  await emitChatMessageNotifications({
    messageId: posted.id,
    mentionedUserIds: posted.mentioned,
  });
  return posted.id;
}

async function openHandoff(input: {
  roomId: string;
  parentId: string;
  match: StandupMatch & { askedFor: string };
  records: AgentRecord[];
}): Promise<string | null> {
  const offering = input.records.find(
    (record) => record.agent.id === input.match.offeringAgentId,
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
      parentMessageId: input.parentId,
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
  /** The opener. */
  messageId: string | null;
  /** Each posting agent's message, by agent id. */
  agentMessageIds: Record<string, string>;
  mentionIds: string[];
}

/** Bots their owner or the platform paused, or past their daily allowance, post nothing. */
async function mayPost(record: AgentRecord): Promise<boolean> {
  if (record.agent.kind !== "sokoBot") return true;
  return (await proactiveGate(record.agent.id)).ok;
}

/** One stand-up for one slot; the run row makes it happen once. */
export async function runTeamStandup(input: {
  standupId: string;
  scheduledFor: Date;
  dispatch?: (mentionId: string) => Promise<void>;
  /** Tests stand in for the models; every real run asks them. */
  host?: typeof hostStandup;
  writeBot?: typeof writeBotUpdate;
  shorten?: typeof shortenTitles;
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
  const quiet = async (): Promise<StandupRunOutcome> => {
    await prisma.teamStandupRun.update({
      where: { id: runId },
      data: { status: "QUIET" },
    });
    return {
      status: "QUIET",
      runId,
      messageId: null,
      agentMessageIds: {},
      mentionIds: [],
    };
  };
  try {
    const workspace = await workspaceOf(standup.organizationId);
    if (!workspace) throw new Error("The organization has no workspace");
    const until = await databaseNow();
    const previous = await prisma.teamStandupRun.findFirst({
      where: {
        standupId: standup.id,
        kind: "DAILY",
        id: { not: runId },
        status: { in: ["POSTED", "QUIET"] },
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    const since =
      previous?.createdAt ?? new Date(until.getTime() - LOOKBACK_MS);
    const collected = await collectAgentRecords({
      workspaceId: workspace.id,
      since,
      until,
    });
    const records: AgentRecord[] = [];
    for (const record of collected)
      if (records.length < MAX_AGENT_MESSAGES && (await mayPost(record)))
        records.push(record);
    if (records.length === 0) return await quiet();

    const bots = records.filter((record) => record.agent.kind === "sokoBot");
    const coworkers = records.filter(
      (record) => record.agent.kind === "coworker",
    );
    const owners = await prisma.sokoBot.findMany({
      where: { id: { in: bots.map((record) => record.agent.id) } },
      select: { id: true, userId: true },
    });
    const needs = await openNeeds(
      workspace.id,
      owners.map((bot) => ({ id: bot.id, ownerId: bot.userId })),
      since,
    );
    const work = await workInProgress(
      workspace.id,
      coworkers.map((record) => record.agent.id),
    );
    const host = await (input.host ?? hostStandup)({
      records,
      needs,
      work,
    }).catch((error: unknown) => {
      recordCoreWarning(
        { operation: "team_standup_host" },
        {
          message: "The stand-up opened no hand-offs today",
          why: "The small model that proposes matches failed",
          fix: "Nothing: every agent still posts; matches return with the model.",
        },
        { failure: messageSafeErrorFields(error) },
      );
      return { matches: [], costUsd: 0 };
    });
    let costUsd = host.costUsd;
    const updates = new Map<string, BotUpdate>();
    for (const record of bots) {
      const update = await (input.writeBot ?? writeBotUpdate)(record);
      costUsd += update.costUsd;
      updates.set(record.agent.id, update);
    }
    const titles = await (input.shorten ?? shortenTitles)(
      coworkers.flatMap((record) => [
        ...record.finished,
        ...record.working,
        ...record.waiting.map((wait) => wait.task),
      ]),
    );
    costUsd += titles.costUsd;
    const spentMicros = BigInt(Math.round(costUsd * 1e6));
    const affordable = Math.max(
      0,
      Math.floor(
        Number(standup.costCapUsdMicros - spentMicros) /
          HANDOFF_ESTIMATE_USD_MICROS,
      ),
    );
    const matches = host.matches.slice(0, Math.min(MAX_MATCHES, affordable));

    const roomId = await ensureStandupRoom(standup);
    await seatParticipants(roomId, records);
    const date = new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: standup.timezone,
    }).format(input.scheduledFor);
    const openerId = await postStandupMessage({
      roomId,
      runId,
      content: standupOpener(date),
    });
    const agentMessageIds: Record<string, string> = {};
    for (const record of records) {
      const content =
        record.agent.kind === "sokoBot"
          ? updates.get(record.agent.id)!.text
          : coworkerStandupMessage(
              record,
              (task) => titles.short.get(task) ?? task,
            );
      agentMessageIds[record.agent.id] = await postStandupMessage({
        roomId,
        runId,
        content,
        sender: record.agent,
      });
    }
    const mentionIds: string[] = [];
    for (const match of matches) {
      const parentId = agentMessageIds[match.needingAgentId];
      if (!parentId) continue;
      const mentionId = await openHandoff({ roomId, parentId, match, records });
      if (mentionId) mentionIds.push(mentionId);
    }
    await prisma.teamStandupRun.update({
      where: { id: runId },
      data: {
        status: "POSTED",
        messageId: openerId,
        lines: jsonInput(
          records.map((record) => ({
            ...record,
            messageId: agentMessageIds[record.agent.id],
            source:
              record.agent.kind === "sokoBot"
                ? updates.get(record.agent.id)?.source
                : "core",
          })),
        ),
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
    return {
      status: "POSTED",
      runId,
      messageId: openerId,
      agentMessageIds,
      mentionIds,
    };
  } catch (error) {
    await prisma.teamStandupRun.update({
      where: { id: runId },
      data: {
        status: "FAILED",
        error: error instanceof Error ? error.message.slice(0, 500) : "failed",
      },
    });
    return {
      status: "FAILED",
      runId,
      messageId: null,
      agentMessageIds: {},
      mentionIds: [],
    };
  }
}

/** Platform switch: admins pause every stand-up at once (Soko Bot settings). */
export async function standupsPaused(): Promise<boolean> {
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
