import {
  composeSokoBotIntroduction,
  isSokoBotSilentAnswer,
} from "@sokosumi/soko-bot";

import prisma from "@/lib/db/prisma";

/**
 * Soko Bot in chat. The bot is a first-class orchestrator participant
 * (`ChatRoomOrchestratorMember` / `senderOrchestratorId`). Legacy bots may
 * still have a shadow `Coworker` row; read paths fall back there until
 * SOK-945 remaps them. Only dispatch differs: a mention starts a Soko Bot
 * turn and the turn's outcome is written back here.
 */

const PROGRESS_PUBLISH_MIN_INTERVAL_MS = 250;

/** Human labels for capability calls shown as live "thought" beats. */
const CAPABILITY_LABELS: Record<string, string> = {
  refresh_context: "Refreshing context",
  find_coworkers: "Finding Coworkers",
  create_task: "Creating a Task",
  update_task: "Updating a Task",
  assign_task: "Assigning a Task",
  get_task_status: "Checking Task status",
  find_agents: "Searching Agents",
  get_agent_input_schema: "Reading Agent inputs",
  hire_agent: "Hiring an Agent",
  get_job_status: "Checking Job status",
  provide_job_input: "Answering a Job",
  request_user_decision: "Asking for your approval",
  read_memory: "Reading memory",
  update_memory: "Updating memory",
};

export function sokoBotCapabilityLabel(toolName: string | null): string {
  if (!toolName) return "Working";
  return CAPABILITY_LABELS[toolName] ?? toolName.replaceAll("_", " ");
}

export interface SokoBotDirectDeliveryRoomCandidate {
  id: string;
  organizationId: string | null;
  updatedAt: Date;
  messageCount: number;
  isOrchestrator: boolean;
}

/**
 * Prefer a room that already has history, then personal (null org), then
 * orchestrator over legacy shadow coworker, then most recently updated.
 * Prevents empty org orchestrator rooms from stealing delivery from a
 * personal legacy DM with history.
 */
export function selectSokoBotDirectDeliveryRoom(
  candidates: readonly SokoBotDirectDeliveryRoomCandidate[],
): SokoBotDirectDeliveryRoomCandidate | null {
  if (candidates.length === 0) {
    return null;
  }
  return [...candidates].sort((left, right) => {
    const byHistory =
      Number(right.messageCount > 0) - Number(left.messageCount > 0);
    if (byHistory !== 0) {
      return byHistory;
    }
    const byPersonal =
      Number(left.organizationId === null) -
      Number(right.organizationId === null);
    if (byPersonal !== 0) {
      return byPersonal;
    }
    const byOrchestrator =
      Number(right.isOrchestrator) - Number(left.isOrchestrator);
    if (byOrchestrator !== 0) {
      return byOrchestrator;
    }
    return right.updatedAt.getTime() - left.updatedAt.getTime();
  })[0]!;
}

interface ChatLinkedTurn {
  id: string;
  status: string;
  finalAnswer: string | null;
  errorDetail: string | null;
  startedAt: Date | null;
  createdAt: Date;
  completedAt: Date | null;
  chatMentionId: string | null;
  chatResponseMessageId: string | null;
  chainDepth: number;
}

async function publishRealtime(
  messageId: string,
  eventType: "update" | "mention_status" | "delete",
): Promise<void> {
  const { publishChatRoomMessageRealtimeById } = await import(
    "@/helpers/chat-room-message-realtime"
  );
  await publishChatRoomMessageRealtimeById(messageId, eventType);
}

async function loadChatLinkedTurn(turnId: string): Promise<
  | (ChatLinkedTurn & {
      mention: {
        id: string;
        messageId: string;
        roomId: string;
        coworkerId: string | null;
        orchestratorId: string | null;
      } | null;
      steps: string[];
      pendingDecisionIds: string[];
      taskIds: string[];
    })
  | null
> {
  const turn = await prisma.sokoBotTurn.findUnique({
    where: { id: turnId },
    select: {
      id: true,
      status: true,
      finalAnswer: true,
      chainDepth: true,
      errorDetail: true,
      startedAt: true,
      createdAt: true,
      completedAt: true,
      chatMentionId: true,
      chatResponseMessageId: true,
      chatMention: {
        select: {
          id: true,
          coworkerId: true,
          orchestratorId: true,
          messageId: true,
          message: { select: { roomId: true } },
        },
      },
      events: {
        where: { type: "actions.requested" },
        orderBy: { sequence: "asc" },
        select: { toolName: true },
      },
      pendingDecisions: {
        where: { status: "PENDING" },
        select: { id: true },
      },
      delegations: {
        where: { taskId: { not: null } },
        select: { taskId: true },
      },
    },
  });
  if (!turn?.chatMentionId || !turn.chatResponseMessageId) return null;
  return {
    ...turn,
    mention: turn.chatMention
      ? {
          id: turn.chatMention.id,
          messageId: turn.chatMention.messageId,
          roomId: turn.chatMention.message.roomId,
          coworkerId: turn.chatMention.coworkerId,
          orchestratorId: turn.chatMention.orchestratorId,
        }
      : null,
    steps: turn.events.map((event) => sokoBotCapabilityLabel(event.toolName)),
    pendingDecisionIds: turn.pendingDecisions.map((decision) => decision.id),
    taskIds: turn.delegations
      .map((delegation) => delegation.taskId)
      .filter((id): id is string => id !== null),
  };
}

const lastProgressPublishAt = new Map<string, number>();

/**
 * Mirror tool progress into the room's Thought placeholder so the chat shows
 * "Creating a Task…" beats live. Only Core-projected labels, never model
 * reasoning. Throttled per message.
 */
export async function publishSokoBotChatProgress(
  turnId: string,
): Promise<void> {
  const turn = await loadChatLinkedTurn(turnId);
  if (!turn?.mention || !turn.chatResponseMessageId) return;
  const now = Date.now();
  const last = lastProgressPublishAt.get(turn.chatResponseMessageId) ?? 0;
  if (now - last < PROGRESS_PUBLISH_MIN_INTERVAL_MS) return;
  lastProgressPublishAt.set(turn.chatResponseMessageId, now);

  await prisma.chatRoomMessage.update({
    where: { id: turn.chatResponseMessageId },
    data: {
      metadata: {
        in_reply_to_message_id: turn.mention.messageId,
        mention_id: turn.mention.id,
        streaming: true,
        reasoning: turn.steps.map((text) => ({ type: "reasoning", text })),
        thought_timing_ms: {
          start: (turn.startedAt ?? turn.createdAt).getTime(),
        },
        soko_bot: { turn_id: turn.id },
      },
    },
  });
  await publishRealtime(turn.chatResponseMessageId, "update");
}

/**
 * Write a settled turn back into the room: the answer replaces the Thought
 * placeholder, the mention is marked responded, and pending approvals /
 * created Tasks ride along in metadata for the chat UI. Failures keep the
 * coworker-style failed shell so the room explains what happened.
 */
export class SokoBotIntroductionError extends Error {}

/**
 * Posts the bot's self-introduction into its direct room once. Idempotent:
 * a room where the bot already spoke gets the existing message back.
 */
export async function introduceSokoBot(input: {
  userId: string;
  workspaceId: string;
  roomId: string;
}): Promise<{ messageId: string }> {
  const bot = await prisma.sokoBot.findFirst({
    where: {
      userId: input.userId,
      workspaceId: input.workspaceId,
      archivedAt: null,
    },
    select: {
      id: true,
      name: true,
      user: { select: { name: true } },
      coworker: { select: { id: true } },
    },
  });
  if (!bot) throw new SokoBotIntroductionError("Soko Bot not found");
  const room = await prisma.chatRoom.findFirst({
    where: {
      id: input.roomId,
      kind: "direct",
      userMembers: { some: { userId: input.userId } },
      OR: [
        { orchestratorMembers: { some: { orchestratorId: bot.id } } },
        ...(bot.coworker
          ? [{ coworkerMembers: { some: { coworkerId: bot.coworker.id } } }]
          : []),
      ],
    },
    select: { id: true },
  });
  if (!room) throw new SokoBotIntroductionError("Direct room not found");
  const usesOrchestrator = await prisma.chatRoomOrchestratorMember.findFirst({
    where: { roomId: room.id, orchestratorId: bot.id },
    select: { id: true },
  });
  const legacyCoworkerId = bot.coworker?.id ?? null;
  const existing = await prisma.chatRoomMessage.findFirst({
    where: {
      roomId: room.id,
      OR: [
        ...(usesOrchestrator ? [{ senderOrchestratorId: bot.id }] : []),
        ...(legacyCoworkerId ? [{ senderCoworkerId: legacyCoworkerId }] : []),
      ],
    },
    select: { id: true },
  });
  if (existing) return { messageId: existing.id };
  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.chatRoomMessage.create({
      data: {
        roomId: room.id,
        ...(usesOrchestrator
          ? { senderOrchestratorId: bot.id, senderCoworkerId: null }
          : { senderCoworkerId: legacyCoworkerId }),
        content: composeSokoBotIntroduction({
          name: bot.name,
          ownerName: bot.user.name,
        }),
      },
      select: { id: true },
    });
    await tx.chatRoom.update({
      where: { id: room.id },
      data: { updatedAt: new Date() },
    });
    return created;
  });
  const { publishChatRoomMessageRealtimeById } = await import(
    "@/helpers/chat-room-message-realtime"
  );
  await publishChatRoomMessageRealtimeById(message.id, "create");
  return { messageId: message.id };
}

/**
 * Turns the bot started itself (schedules, coworker events, inbox ingests)
 * have no chat message to write back to; post the answer into the owner's
 * direct room with the bot so they see it where they talk to it.
 */
export async function deliverSokoBotTurnToDirectRoom(
  turnId: string,
): Promise<void> {
  const turn = await prisma.sokoBotTurn.findUnique({
    where: { id: turnId },
    select: {
      source: true,
      status: true,
      finalAnswer: true,
      userId: true,
      sokoBotId: true,
      chatMention: { select: { id: true } },
      sokoBot: { select: { coworker: { select: { id: true } } } },
    },
  });
  if (!turn || turn.source === "CHAT" || turn.chatMention) return;
  if (turn.status !== "COMPLETED") return;
  const answer = turn.finalAnswer?.trim() ?? "";
  if (isSokoBotSilentAnswer(answer)) return;
  const legacyCoworkerId = turn.sokoBot.coworker?.id ?? null;
  const candidateRooms = await prisma.chatRoom.findMany({
    where: {
      kind: "direct",
      archivedAt: null,
      userMembers: { some: { userId: turn.userId } },
      OR: [
        { orchestratorMembers: { some: { orchestratorId: turn.sokoBotId } } },
        ...(legacyCoworkerId
          ? [{ coworkerMembers: { some: { coworkerId: legacyCoworkerId } } }]
          : []),
      ],
    },
    select: {
      id: true,
      organizationId: true,
      updatedAt: true,
      orchestratorMembers: {
        where: { orchestratorId: turn.sokoBotId },
        select: { orchestratorId: true },
        take: 1,
      },
      _count: { select: { messages: true } },
    },
  });
  const selected = selectSokoBotDirectDeliveryRoom(
    candidateRooms.map((candidate) => ({
      id: candidate.id,
      organizationId: candidate.organizationId,
      updatedAt: candidate.updatedAt,
      messageCount: candidate._count.messages,
      isOrchestrator: candidate.orchestratorMembers.length > 0,
    })),
  );
  if (!selected) return;
  const room = { id: selected.id };
  const usesOrchestrator = selected.isOrchestrator;
  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.chatRoomMessage.create({
      data: {
        roomId: room.id,
        ...(usesOrchestrator
          ? { senderOrchestratorId: turn.sokoBotId, senderCoworkerId: null }
          : { senderCoworkerId: legacyCoworkerId }),
        content: answer,
        metadata: { soko_bot: { turn_id: turnId, source: turn.source } },
      },
      select: { id: true },
    });
    await tx.chatRoom.update({
      where: { id: room.id },
      data: { updatedAt: new Date() },
    });
    return created;
  });
  const { publishChatRoomMessageRealtimeById } = await import(
    "@/helpers/chat-room-message-realtime"
  );
  await publishChatRoomMessageRealtimeById(message.id, "create");
}

export async function finalizeSokoBotChatTurn(turnId: string): Promise<void> {
  const turn = await loadChatLinkedTurn(turnId);
  if (!turn?.mention || !turn.chatResponseMessageId) return;
  lastProgressPublishAt.delete(turn.chatResponseMessageId);
  const mention = turn.mention;
  const responseMessageId = turn.chatResponseMessageId;

  const answer = turn.finalAnswer?.trim() ?? "";
  const succeeded = turn.status === "COMPLETED" && answer.length > 0;
  // A bot answering another bot may say nothing at all. Without this every
  // hop must produce a message, so a depth ceiling would bound how long an
  // exchange runs without ever letting one end early — and "thanks" would
  // cost a turn. The placeholder goes away rather than becoming an answer.
  const stayedSilent =
    turn.chainDepth > 0 &&
    turn.status === "COMPLETED" &&
    isSokoBotSilentAnswer(answer);
  if (stayedSilent) {
    await prisma.$transaction(async (tx) => {
      await tx.chatRoomMention.updateMany({
        where: { id: mention.id, status: { in: ["pending", "sent"] } },
        data: { status: "responded", error: null },
      });
      await tx.chatRoomMessage.delete({ where: { id: responseMessageId } });
    });
    await publishRealtime(responseMessageId, "delete");
    await publishRealtime(mention.messageId, "mention_status");
    return;
  }
  const startedAtMs = (turn.startedAt ?? turn.createdAt).getTime();
  const endedAtMs = (turn.completedAt ?? new Date()).getTime();

  await prisma.$transaction(async (tx) => {
    if (succeeded) {
      await tx.chatRoomMention.updateMany({
        where: { id: mention.id, status: { in: ["pending", "sent"] } },
        data: { status: "responded", error: null },
      });
      await tx.chatRoomMessage.update({
        where: { id: responseMessageId },
        data: {
          content: answer,
          ...(mention.orchestratorId
            ? {
                senderOrchestratorId: mention.orchestratorId,
                senderCoworkerId: null,
              }
            : {}),
          metadata: {
            in_reply_to_message_id: mention.messageId,
            mention_id: mention.id,
            // Same shape `thoughtMetadataFields` writes for coworkers, inlined
            // so this module never drags the realtime/auth import chain in.
            ...(turn.steps.length > 0
              ? {
                  reasoning: turn.steps.map((text) => ({
                    type: "reasoning",
                    text,
                  })),
                  thought_timing_ms: { start: startedAtMs, end: endedAtMs },
                }
              : {}),
            soko_bot: {
              turn_id: turn.id,
              pending_decision_ids: turn.pendingDecisionIds,
              task_ids: turn.taskIds,
            },
          },
        },
      });
      await tx.chatRoom.update({
        where: { id: mention.roomId },
        data: { updatedAt: new Date() },
      });
      return;
    }
    const error =
      turn.status === "CANCELLED"
        ? "Soko Bot turn was cancelled"
        : (turn.errorDetail ?? "Soko Bot could not answer");
    await tx.chatRoomMention.updateMany({
      where: { id: mention.id, status: { in: ["pending", "sent"] } },
      data: { status: "failed", error: error.slice(0, 500) },
    });
    await tx.chatRoomMessage.update({
      where: { id: responseMessageId },
      data: {
        content: "",
        metadata: {
          in_reply_to_message_id: mention.messageId,
          mention_id: mention.id,
          mention_failed: true,
          soko_bot: { turn_id: turn.id },
        },
      },
    });
  });

  await publishRealtime(responseMessageId, "update");
  await publishRealtime(mention.messageId, "mention_status");
}
