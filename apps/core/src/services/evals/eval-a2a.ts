import { sharedTable } from "@sokosumi/database/sql-tables";
import {
  A2A_SCENARIOS,
  type ScenarioCheck,
  type SokoBotScenario,
} from "@sokosumi/soko-bot";
import { z } from "zod";
import { databaseNow } from "@/lib/db/database-now";
import prisma from "@/lib/db/prisma";
import { forgetEvalWorkspaces } from "@/lib/evals/eval-guard";
import {
  EMPTY_COWORKER_RESPONSE,
  EVAL_COWORKER,
  setEvalCoworkerScript,
} from "@/lib/evals/fake-coworker";
import { recordCoreWarning } from "@/lib/evlog";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import {
  EFFECT_PUBLICATION_FAILED,
  syncSokoBotEffects,
} from "@/services/soko-bot-effect-outbox.service";
import { loadLabScenarioTurn } from "@/services/soko-bot-lab-scenario.service";
import { syncSokoBotWatches } from "@/services/soko-bot-watches.service";
import type { EvalLaneRecord } from "./eval-lanes.service";

/**
 * Agent-to-agent cases (`SokoBotScenario.exchange`): the owner's turn asks
 * Mira (a scripted Coworker), Hannah (a scripted teammate) or Juno (Hannah's
 * own Soko Bot, which runs for real), and every follow-up the bot's waits
 * start belongs to the case. Each poll moves the other side along and checks
 * the bot's waits itself, so a case runs the same with or without the cron.
 */

const VENDOR_SLUG = "sokosumi-evals";
const JUNO_NAME = "Juno";
const HANNAH_TASK = "EU marketplace pricing research";
/** A wait still open this long after everything went quiet runs out now. */
const QUIET_MS = 120_000;
export const A2A_CHAIN_TIMEOUT_MS = 40 * 60_000;
/** Failed publications of one chat effect before the case stops as an infrastructure error (~6 minutes of backoff). */
export const A2A_DELIVERY_ATTEMPTS = 3;

export interface A2aWorld {
  coworkerId: string;
  junoId: string;
}

export function isA2aScenario(scenario: SokoBotScenario): boolean {
  return scenario.exchange !== undefined;
}

function nextThursday(now: Date): Date {
  const date = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  date.setUTCDate(date.getUTCDate() + ((4 - date.getUTCDay() + 7) % 7 || 7));
  return date;
}

/** Mira, Juno in the Launch team room, and Hannah's Task Juno answers from. */
export async function ensureA2aWorld(lane: EvalLaneRecord): Promise<A2aWorld> {
  const vendor = await prisma.vendor.upsert({
    where: { slug: VENDOR_SLUG },
    create: { slug: VENDOR_SLUG, name: "Sokosumi Evals" },
    update: {},
    select: { id: true },
  });
  const slug = `mira-evals-${lane.lane}`;
  const coworker = await prisma.coworker.upsert({
    where: { slug },
    create: {
      slug,
      name: EVAL_COWORKER.name,
      caption: "Research",
      description: EVAL_COWORKER.description,
      baseURL: EVAL_COWORKER.baseURL,
      capabilities: ["tasks", "chat"],
      vendorId: vendor.id,
    },
    update: { archivedAt: null, baseURL: EVAL_COWORKER.baseURL },
    select: { id: true },
  });
  await prisma.coworkerWorkspaceAccess.upsert({
    where: {
      coworkerId_workspaceId: {
        coworkerId: coworker.id,
        workspaceId: lane.workspaceId,
      },
    },
    create: {
      coworkerId: coworker.id,
      workspaceId: lane.workspaceId,
      status: "GRANTED",
    },
    update: { status: "GRANTED" },
  });
  forgetEvalWorkspaces();

  const hannahId = lane.world.hannahUserId;
  const existing = await prisma.sokoBot.findFirst({
    where: {
      userId: hannahId,
      workspaceId: lane.workspaceId,
      archivedAt: null,
    },
    select: { id: true },
  });
  const junoId =
    existing?.id ??
    (
      await sokoBotControlPlane.create({
        userId: hannahId,
        workspaceId: lane.workspaceId,
        name: JUNO_NAME,
      })
    ).id;
  // Paused, she would refuse every mention as unprompted work.
  await prisma.sokoBot.update({
    where: { id: junoId },
    // Every case asks her; the daily limit for turns nobody started would
    // end the day's runs early.
    data: {
      proactivePaused: false,
      proactiveDailyLimit: 1_000,
      ingestTimezone: "Europe/Berlin",
    },
  });
  await prisma.chatRoomSokoBotMember.upsert({
    where: {
      roomId_sokoBotId: { roomId: lane.world.roomId, sokoBotId: junoId },
    },
    create: { roomId: lane.world.roomId, sokoBotId: junoId },
    update: {},
  });

  const dueOn = nextThursday(await databaseNow());
  const task = await prisma.task.findFirst({
    where: { workspaceId: lane.workspaceId, name: HANNAH_TASK },
    select: { id: true },
  });
  const taskData = {
    archivedAt: null,
    status: "RUNNING" as const,
    dueOn,
    description:
      "Pricing pages of the five EU AI-agent marketplaces: two done (Langdock, Agentur.ai), three to go. Write-up after.",
  };
  if (task)
    await prisma.task.update({ where: { id: task.id }, data: taskData });
  else
    await prisma.task.create({
      data: {
        ...taskData,
        name: HANNAH_TASK,
        workspaceId: lane.workspaceId,
        organizationId: lane.organizationId,
        ownerId: hannahId,
        creatorUserId: hannahId,
        assigneeUserId: hannahId,
      },
    });
  return { coworkerId: coworker.id, junoId };
}

/**
 * Mira and Juno exist for these cases only: left in the lane, every other
 * case would hand research to Mira and find Juno in the team room.
 */
export async function closeA2aWorld(lane: EvalLaneRecord): Promise<void> {
  await prisma.coworkerWorkspaceAccess.updateMany({
    where: {
      workspaceId: lane.workspaceId,
      coworker: { slug: `mira-evals-${lane.lane}` },
    },
    data: { status: "REVOKED" },
  });
  await prisma.chatRoomSokoBotMember.deleteMany({
    where: {
      roomId: lane.world.roomId,
      sokoBot: { userId: lane.world.hannahUserId },
    },
  });
  await prisma.sokoBot.updateMany({
    where: { userId: lane.world.hannahUserId, workspaceId: lane.workspaceId },
    data: { proactivePaused: true },
  });
  await prisma.task.updateMany({
    where: {
      workspaceId: lane.workspaceId,
      name: HANNAH_TASK,
      archivedAt: null,
    },
    data: { archivedAt: new Date() },
  });
  forgetEvalWorkspaces();
}

/**
 * Each case starts its rooms fresh: the question rooms earlier cases opened
 * are archived, and their assistant messages count as an hour old, so the
 * hourly backstop measures this case's traffic only.
 */
async function clearEarlierTraffic(lane: EvalLaneRecord): Promise<void> {
  const scripted = A2A_SCENARIOS.flatMap(
    (scenario) => scenario.exchange?.messages ?? [],
  );
  await prisma.chatRoomMessage.updateMany({
    where: {
      room: { organizationId: lane.organizationId },
      deletedAt: null,
      OR: [
        { senderSokoBotId: { not: null } },
        { senderCoworkerId: { not: null } },
        { senderUserId: lane.world.hannahUserId, content: { in: scripted } },
      ],
    },
    data: { deletedAt: new Date() },
  });
  await prisma.chatRoom.updateMany({
    where: {
      organizationId: lane.organizationId,
      archivedAt: null,
      kind: "channel",
      id: { not: lane.world.roomId },
      sokoBotMembers: { some: { sokoBotId: lane.sokoBotId } },
    },
    data: { archivedAt: new Date() },
  });
  await prisma.$executeRaw`
    UPDATE ${sharedTable("chat_room_message")} m SET "createdAt" = m."createdAt" - interval '1 hour'
    FROM ${sharedTable("chat_room")} r
    WHERE r.id = m."roomId" AND r."organizationId" = ${lane.organizationId}
      AND m."createdAt" > now() - interval '1 hour'
      AND (m."senderSokoBotId" IS NOT NULL OR m."senderCoworkerId" IS NOT NULL)`;
}

/** Before the owner's turn: the world, and Mira's script for this case. */
export async function prepareA2aCase(
  lane: EvalLaneRecord,
  scenario: SokoBotScenario,
): Promise<Record<string, unknown>> {
  await clearEarlierTraffic(lane);
  const world = await ensureA2aWorld(lane);
  await setEvalCoworkerScript(
    world.coworkerId,
    scenario.exchange?.with === "coworker"
      ? (scenario.exchange.replies ?? [])
      : [],
  );
  return { a2a: world };
}

async function chainTurnIds(firstTurnId: string, sokoBotId: string) {
  const children = await prisma.sokoBotTurn.findMany({
    where: { sokoBotId, parentTurnId: firstTurnId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return [firstTurnId, ...children.map((turn) => turn.id)];
}

/** Hannah's scripted messages, posted where the bot first wrote to her. */
async function postTeammateMessages(
  lane: EvalLaneRecord,
  scenario: SokoBotScenario,
  startedAt: Date,
  now: Date,
): Promise<boolean> {
  const messages = scenario.exchange?.messages ?? [];
  if (messages.length === 0) return true;
  const asked = await prisma.chatRoomMessage.findFirst({
    where: {
      senderSokoBotId: lane.sokoBotId,
      deletedAt: null,
      createdAt: { gte: startedAt },
      room: { userMembers: { some: { userId: lane.world.hannahUserId } } },
    },
    orderBy: { createdAt: "asc" },
    select: { roomId: true, createdAt: true },
  });
  if (!asked) return false;
  const posted = await prisma.chatRoomMessage.count({
    where: {
      roomId: asked.roomId,
      senderUserId: lane.world.hannahUserId,
      createdAt: { gte: asked.createdAt },
    },
  });
  if (posted >= messages.length) return true;
  const gapMs = (scenario.exchange?.gapSeconds ?? 30) * 1_000;
  const last = await prisma.chatRoomMessage.findFirst({
    where: {
      roomId: asked.roomId,
      senderUserId: lane.world.hannahUserId,
      createdAt: { gte: asked.createdAt },
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (last && now.getTime() - last.createdAt.getTime() < gapMs) return false;
  await prisma.chatRoomMessage.create({
    data: {
      roomId: asked.roomId,
      senderUserId: lane.world.hannahUserId,
      content: messages[posted]!,
    },
  });
  return posted + 1 >= messages.length;
}

export type A2aPoll =
  | { kind: "waiting" }
  | { kind: "done"; turnIds: string[]; timedOut: boolean }
  /**
   * A message of the case never got out, or Mira's scripted answer failed:
   * the other side cannot answer, so waiting proves nothing. `turnIds` holds
   * every turn of the case (`a2aCaseScope`), the answering agents' included.
   */
  | { kind: "undelivered"; turnIds: string[]; detail: string };

/** The chat messages these turns posted: every one goes out through its effect. */
async function postedMessageIds(turnIds: string[]): Promise<string[]> {
  const posted = await prisma.sokoBotEffectOutbox.findMany({
    where: { purpose: "CHAT_MESSAGE", receipt: { turnId: { in: turnIds } } },
    select: { payload: true },
  });
  return posted.flatMap(({ payload }) => {
    const parsed = z.object({ messageId: z.string() }).safeParse(payload);
    return parsed.success ? [parsed.data.messageId] : [];
  });
}

export interface A2aCaseScope {
  turnIds: string[];
  messageIds: string[];
}

/**
 * What belongs to the case: the bot's chain, then the turns that answered its
 * messages' mentions (Juno's), their own follow-ups and answers, and every
 * message those turns posted. Nothing else in the workspace.
 */
export async function a2aCaseScope(chain: string[]): Promise<A2aCaseScope> {
  const turnIds = [...chain];
  for (let round = 0; round < 8; round += 1) {
    const messageIds = await postedMessageIds(turnIds);
    const more = await prisma.sokoBotTurn.findMany({
      where: {
        id: { notIn: turnIds },
        OR: [
          { parentTurnId: { in: turnIds } },
          { chatMention: { messageId: { in: messageIds } } },
        ],
      },
      select: { id: true },
    });
    if (more.length === 0) return { turnIds, messageIds };
    turnIds.push(...more.map((turn) => turn.id));
  }
  return { turnIds, messageIds: await postedMessageIds(turnIds) };
}

/**
 * Why the case cannot go on, when its own delivery broke: a chat effect of
 * one of its turns with A2A_DELIVERY_ATTEMPTS settled failures (a leased
 * attempt is still running), or a mention of Mira on one of its messages that
 * failed for any reason but her scripted silence. A bot that never asked has
 * neither, and stays a behavioural failure.
 */
async function caseDeliveryFailure(
  scope: A2aCaseScope,
  now: Date,
): Promise<string | null> {
  const effect = await prisma.sokoBotEffectOutbox.findFirst({
    where: {
      purpose: "CHAT_MESSAGE",
      receipt: { turnId: { in: scope.turnIds } },
      status: { in: ["PENDING", "PERSISTED"] },
      attempts: { gte: A2A_DELIVERY_ATTEMPTS },
      lastErrorCategory: { startsWith: EFFECT_PUBLICATION_FAILED },
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
    },
    select: { id: true, attempts: true, lastErrorCategory: true },
  });
  if (effect)
    return `Chat effect ${effect.id} failed ${effect.attempts} publications (${effect.lastErrorCategory})`;
  const mention = await prisma.chatRoomMention.findFirst({
    where: {
      status: "failed",
      coworker: { baseURL: EVAL_COWORKER.baseURL },
      messageId: { in: scope.messageIds },
      NOT: { error: EMPTY_COWORKER_RESPONSE },
    },
    select: { id: true, error: true },
  });
  return mention
    ? `${EVAL_COWORKER.name}'s scripted answer to mention ${mention.id} failed: ${mention.error ?? "no error recorded"}`
    : null;
}

/**
 * Ends what the case left running: each of its active turns is cancelled as
 * the member it runs for (Juno's as Hannah), and its unsent messages and
 * their open mentions are closed, so none of it reaches the next case.
 */
export async function endA2aCase(scope: A2aCaseScope): Promise<void> {
  const active = await prisma.sokoBotTurn.findMany({
    where: {
      id: { in: scope.turnIds },
      status: { in: ["STARTING", "RUNNING", "CANCEL_REQUESTED"] },
    },
    select: {
      id: true,
      requestedByUserId: true,
      sokoBot: { select: { userId: true } },
    },
  });
  for (const turn of active) {
    const member = turn.requestedByUserId ?? turn.sokoBot.userId;
    await (member
      ? sokoBotControlPlane.cancelTurn(member, turn.id)
      : Promise.reject(new Error("The turn runs for no member"))
    ).catch((error: unknown) =>
      recordCoreWarning(
        { operation: "eval_tick", turnId: turn.id },
        {
          message: "Could not cancel a turn of an ended eval case",
          why: "Cancelling it as the member it runs for threw",
        },
        { failure: messageSafeErrorFields(error) },
      ),
    );
  }
  await prisma.sokoBotEffectOutbox.updateMany({
    where: {
      purpose: "CHAT_MESSAGE",
      status: { in: ["PENDING", "PERSISTED"] },
      receipt: { turnId: { in: scope.turnIds } },
    },
    data: {
      status: "SUPPRESSED",
      reason: "EVAL_CASE_ENDED",
      leaseToken: null,
      leaseUntil: null,
    },
  });
  await prisma.chatRoomMention.updateMany({
    where: {
      status: { in: ["staged", "pending"] },
      messageId: { in: scope.messageIds },
    },
    data: { status: "failed", error: "The eval case ended" },
  });
}

/**
 * One step of a chain: waits while any turn of it (or Juno's answer, or
 * Mira's) is under way, plays the teammate, ends a wait that can only run
 * out, and checks the bot's waits so their follow-ups start.
 */
export async function pollA2aChain(input: {
  scenario: SokoBotScenario;
  firstTurnId: string;
  lane: EvalLaneRecord;
  startedAt: Date;
}): Promise<A2aPoll> {
  const { scenario, firstTurnId, lane, startedAt } = input;
  const exchange = scenario.exchange;
  if (!exchange)
    throw new Error(`${scenario.id} is not an agent-to-agent case`);
  const now = await databaseNow();
  const turnIds = await chainTurnIds(firstTurnId, lane.sokoBotId);
  if (now.getTime() - startedAt.getTime() > A2A_CHAIN_TIMEOUT_MS)
    return { kind: "done", turnIds, timedOut: true };
  if (turnIds.length - 1 > exchange.maxFollowUps)
    return { kind: "done", turnIds, timedOut: false };
  const scope = await a2aCaseScope(turnIds);
  // The sync cron does this when Core is deployed; a local run has no cron,
  // and only this case's own messages are its business.
  await syncSokoBotEffects({
    shouldContinue: () => true,
    abortSignal: new AbortController().signal,
    turnIds: scope.turnIds,
  });
  const failure = await caseDeliveryFailure(scope, now);
  if (failure)
    return { kind: "undelivered", turnIds: scope.turnIds, detail: failure };

  const active = await prisma.sokoBotTurn.count({
    where: {
      OR: [
        { id: { in: turnIds } },
        {
          sokoBotId: { notIn: [lane.sokoBotId, lane.cusoBotId] },
          workspaceId: lane.workspaceId,
        },
      ],
      status: { notIn: ["COMPLETED", "FAILED", "CANCELLED"] },
      createdAt: { gte: startedAt },
    },
  });
  const inFlight = await prisma.chatRoomMention.count({
    where: {
      status: { in: ["staged", "pending", "sent"] },
      createdAt: { gte: startedAt },
      message: { room: { organizationId: lane.organizationId } },
    },
  });
  if (active > 0 || inFlight > 0) return { kind: "waiting" };

  const scripted = await postTeammateMessages(lane, scenario, startedAt, now);
  const waits = {
    sokoBotId: lane.sokoBotId,
    status: "WAITING" as const,
    createdAt: { gte: startedAt },
  };
  if (exchange.expireWait)
    await prisma.sokoBotWatch.updateMany({
      where: { ...waits, expiresAt: { gt: now } },
      data: { expiresAt: now },
    });
  else if (scripted) {
    const latest = await prisma.chatRoomMessage.findFirst({
      where: {
        room: { organizationId: lane.organizationId },
        createdAt: { gte: startedAt },
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    const settled = await prisma.sokoBotTurn.findFirst({
      where: { id: { in: turnIds } },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    });
    const quietSince = Math.max(
      latest?.createdAt.getTime() ?? 0,
      settled?.updatedAt.getTime() ?? 0,
    );
    if (now.getTime() - quietSince > QUIET_MS)
      await prisma.sokoBotWatch.updateMany({
        where: { ...waits, expiresAt: { gt: now } },
        data: { expiresAt: now },
      });
  }
  const sync = await syncSokoBotWatches({
    shouldContinue: () => true,
    sokoBotId: lane.sokoBotId,
  });
  if (sync.fired > 0 || sync.deferred > 0 || !scripted)
    return { kind: "waiting" };
  const waiting = await prisma.sokoBotWatch.count({ where: waits });
  if (waiting > 0) return { kind: "waiting" };
  return { kind: "done", turnIds, timedOut: false };
}

/** Turns the other assistants ran during the case: their cost is the case's too. */
export async function otherAgentTurnIds(
  lane: EvalLaneRecord,
  startedAt: Date,
): Promise<string[]> {
  const turns = await prisma.sokoBotTurn.findMany({
    where: {
      workspaceId: lane.workspaceId,
      sokoBotId: { notIn: [lane.sokoBotId, lane.cusoBotId] },
      createdAt: { gte: startedAt },
    },
    select: { id: true },
  });
  return turns.map((turn) => turn.id);
}

/** The chain as one turn: the owner's route, every call, the last answer. */
export async function loadA2aChain(turnIds: string[]) {
  const turns = await Promise.all(turnIds.map((id) => loadLabScenarioTurn(id)));
  const first = turns[0]!;
  const last = turns.at(-1)!;
  const merged = {
    ...last,
    userMessage: turns.map((turn) => turn.userMessage).join("\n\n"),
    contextPacket: turns.map((turn) => turn.contextPacket),
    status:
      turns.find((turn) => turn.status !== "COMPLETED")?.status ?? last.status,
    route: first.route,
    toolCalls: turns.flatMap((turn) => turn.toolCalls),
    events: turns.flatMap((turn) => turn.events),
    delegations: turns.flatMap((turn) => turn.delegations),
    decisions: turns.flatMap((turn) => turn.decisions),
    costUsd: turns.reduce((sum, turn) => sum + (turn.costUsd ?? 0), 0),
    durationMs: turns.reduce((sum, turn) => sum + (turn.durationMs ?? 0), 0),
    errorKind: turns.find((turn) => turn.errorKind)?.errorKind ?? null,
  };
  return { turns, merged };
}

/** What every room of the lane said during the case, oldest first. */
export async function a2aRoomLog(lane: EvalLaneRecord, startedAt: Date) {
  const messages = await prisma.chatRoomMessage.findMany({
    where: {
      room: { organizationId: lane.organizationId },
      createdAt: { gte: startedAt },
      deletedAt: null,
      content: { not: "" },
    },
    orderBy: { createdAt: "asc" },
    take: 60,
    select: {
      content: true,
      senderSokoBotId: true,
      room: { select: { name: true } },
      senderUser: { select: { name: true } },
      senderCoworker: { select: { name: true } },
      senderSokoBot: { select: { name: true } },
    },
  });
  return messages.map((message) => ({
    room: message.room.name,
    from:
      message.senderSokoBotId === lane.sokoBotId
        ? "the bot under test"
        : (message.senderUser?.name ??
          message.senderCoworker?.name ??
          message.senderSokoBot?.name ??
          "someone"),
    content: message.content.slice(0, 3_000),
  }));
}

/**
 * The owner heard back after the other side had its say: the chain's last
 * answer settled after the last message anyone else wrote during the case.
 */
async function reportedAfterAnswer(
  lane: EvalLaneRecord,
  startedAt: Date,
  turnIds: string[],
): Promise<ScenarioCheck> {
  const [answered, last] = await Promise.all([
    prisma.chatRoomMessage.findFirst({
      where: {
        room: { organizationId: lane.organizationId },
        createdAt: { gte: startedAt },
        deletedAt: null,
        content: { not: "" },
        OR: [
          { senderCoworkerId: { not: null } },
          { senderSokoBotId: { notIn: [lane.sokoBotId] } },
          { senderUserId: lane.world.hannahUserId },
        ],
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.sokoBotTurn.findUnique({
      where: { id: turnIds.at(-1) },
      select: { updatedAt: true },
    }),
  ]);
  const reportedAt = last?.updatedAt;
  return {
    label: "Reported after the other side answered",
    pass: !answered || (!!reportedAt && reportedAt > answered.createdAt),
    actual: !answered
      ? "nobody answered"
      : reportedAt && reportedAt > answered.createdAt
        ? "yes"
        : "the last answer came before theirs",
  };
}

export async function a2aChecks(input: {
  scenario: SokoBotScenario;
  lane: EvalLaneRecord;
  startedAt: Date;
  turnIds: string[];
  timedOut: boolean;
}): Promise<ScenarioCheck[]> {
  const exchange = input.scenario.exchange!;
  const followUps = input.turnIds.length - 1;
  const checks: ScenarioCheck[] = [
    {
      label: "The chain ended in time",
      pass: !input.timedOut,
      actual: input.timedOut ? "still going after 40 minutes" : "ended",
    },
    await reportedAfterAnswer(input.lane, input.startedAt, input.turnIds),
    {
      label: `At most ${exchange.maxFollowUps} follow-ups`,
      pass: followUps <= exchange.maxFollowUps,
      actual: String(followUps),
    },
  ];
  if (exchange.expectsRequest) {
    const sent = await prisma.chatRoomMessage.findMany({
      where: {
        senderSokoBotId: input.lane.sokoBotId,
        createdAt: { gte: input.startedAt },
        room: { kind: { not: "direct" } },
      },
      select: { content: true },
    });
    const structured = sent.some(
      (message) =>
        /\nRequest\n- Goal: /.test(message.content) &&
        /- By: /.test(message.content),
    );
    checks.push({
      label: "The hand-off went out as a request (goal, deliverable, by when)",
      pass: structured,
      actual: structured ? "yes" : `${sent.length} message(s) without one`,
    });
  }
  if (exchange.maxBotMessages !== undefined) {
    const posted = await prisma.chatRoomMessage.count({
      where: {
        senderSokoBotId: input.lane.sokoBotId,
        deletedAt: null,
        createdAt: { gte: input.startedAt },
        room: { kind: { not: "direct" } },
      },
    });
    checks.push({
      label: `At most ${exchange.maxBotMessages} messages in rooms`,
      pass: posted <= exchange.maxBotMessages,
      actual: String(posted),
    });
  }
  return checks;
}
