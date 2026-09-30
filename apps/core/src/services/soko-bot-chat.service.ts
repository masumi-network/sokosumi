import type { Prisma } from "@sokosumi/database";
import {
  composeSokoBotIntroduction,
  isSokoBotSilentAnswer,
} from "@sokosumi/soko-bot";
import { invalidateChatRoomMessageReaders } from "@/helpers/chat-room-message-created-effects";

import prisma from "@/lib/db/prisma";

/**
 * Soko Bot in chat. The bot is a first-class sokoBot member, sender,
 * and mention target. A mention starts a Soko Bot turn and the turn's
 * outcome is written back here.
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
  read_memory: "Reading memory",
  update_memory: "Updating memory",
  web_search: "Searching the web",
  web_fetch: "Reading a web page",
  bash: "Running a command",
  workspace_read: "Reading a file",
  workspace_write: "Writing a file",
  workspace_list: "Looking through files",
  workspace_search: "Searching files",
  update_plan: "Planning",
  run_subagent: "Asking a helper",
};

export function sokoBotCapabilityLabel(toolName: string | null): string {
  if (!toolName) return "Working";
  return CAPABILITY_LABELS[toolName] ?? toolName.replaceAll("_", " ");
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

async function loadChatLinkedTurn(
  turnId: string,
  client: Prisma.TransactionClient = prisma,
): Promise<
  | (ChatLinkedTurn & {
      mention: { id: string; messageId: string; roomId: string } | null;
      steps: string[];
      pendingDecisionIds: string[];
      taskIds: string[];
    })
  | null
> {
  const turn = await client.sokoBotTurn.findUnique({
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
        }
      : null,
    steps: turn.events.map((event) => sokoBotCapabilityLabel(event.toolName)),
    pendingDecisionIds: turn.pendingDecisions.map((decision) => decision.id),
    // Creating and assigning one Task are two delegations, not two Tasks.
    taskIds: [
      ...new Set(
        turn.delegations
          .map((delegation) => delegation.taskId)
          .filter((id): id is string => id !== null),
      ),
    ],
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

  const updated = await prisma.chatRoomMessage.updateMany({
    where: {
      id: turn.chatResponseMessageId,
      content: "",
      mentionResponseFor: { status: { in: ["pending", "sent"] } },
    },
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
  if (updated.count === 0) return;
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
    },
  });
  if (!bot) throw new SokoBotIntroductionError("Soko Bot not found");
  const room = await prisma.chatRoom.findFirst({
    where: {
      id: input.roomId,
      kind: "direct",
      sokoBotMembers: { some: { sokoBotId: bot.id } },
      userMembers: { some: { userId: input.userId } },
    },
    select: { id: true },
  });
  if (!room) throw new SokoBotIntroductionError("Direct room not found");
  const existing = await prisma.chatRoomMessage.findFirst({
    where: { roomId: room.id, senderSokoBotId: bot.id },
    select: { id: true },
  });
  if (existing) return { messageId: existing.id };
  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.chatRoomMessage.create({
      data: {
        roomId: room.id,
        senderSokoBotId: bot.id,
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
  await announceBotMessage(room.id, message.id);
  return { messageId: message.id };
}

async function announceBotMessage(roomId: string, messageId: string) {
  const { publishChatRoomMessageRealtimeById } = await import(
    "@/helpers/chat-room-message-realtime"
  );
  await Promise.all([
    invalidateChatRoomMessageReaders({ roomId }),
    publishChatRoomMessageRealtimeById(messageId, "create"),
  ]);
}

/**
 * A fixed message from the bot into its owner's direct chat, outside any
 * turn: nothing is classified and nothing wakes the bot. `key` makes it
 * idempotent, so a retry posts once. An owner who never opened the chat gets
 * it opened, with the bot's introduction first. Null when the bot is gone.
 */
export async function postSokoBotOwnerNotice(input: {
  sokoBotId: string;
  content: string;
  key: string;
}): Promise<{ messageId: string } | null> {
  const bot = await prisma.sokoBot.findFirst({
    where: { id: input.sokoBotId, archivedAt: null },
    select: {
      id: true,
      userId: true,
      workspaceId: true,
      workspace: { select: { organizationId: true } },
    },
  });
  if (!bot) return null;
  const room = await findOrOpenOwnerDirectRoom(bot);
  const message = await prisma.$transaction(async (tx) => {
    const posted = await tx.chatRoomMessage.upsert({
      where: {
        roomId_clientMessageId: {
          roomId: room.id,
          clientMessageId: `soko-bot:notice:${input.key}`,
        },
      },
      create: {
        roomId: room.id,
        clientMessageId: `soko-bot:notice:${input.key}`,
        senderSokoBotId: bot.id,
        content: input.content,
      },
      update: {},
      select: { id: true },
    });
    await tx.chatRoom.update({
      where: { id: room.id },
      data: { updatedAt: new Date() },
    });
    return posted;
  });
  await announceBotMessage(room.id, message.id);
  return { messageId: message.id };
}

async function findOrOpenOwnerDirectRoom(bot: {
  id: string;
  userId: string;
  workspaceId: string;
  workspace: { organizationId: string | null };
}): Promise<{ id: string }> {
  const existing = await prisma.chatRoom.findFirst({
    where: {
      kind: "direct",
      sokoBotMembers: { some: { sokoBotId: bot.id } },
      userMembers: { some: { userId: bot.userId } },
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  if (existing) return existing;
  const { createOrGetDirectRoom } = await import(
    "@/routes/v1/chats/rooms/helpers"
  );
  const { room, created } = await createOrGetDirectRoom({
    organizationId: bot.workspace.organizationId,
    currentUserId: bot.userId,
    memberUserIds: [],
    coworkerIds: [],
    sokoBotIds: [bot.id],
  });
  if (created)
    await introduceSokoBot({
      userId: bot.userId,
      workspaceId: bot.workspaceId,
      roomId: room.id,
    });
  return { id: room.id };
}

export async function persistSokoBotChatTurn(
  turnId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const turn = await loadChatLinkedTurn(turnId, tx);
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
    const claimed = await tx.chatRoomMention.updateMany({
      where: { id: mention.id, status: { in: ["pending", "sent"] } },
      data: { status: "responded", error: null },
    });
    if (claimed.count !== 1) return;
    // Retain a tombstone so the durable delivery can retry its delete event.
    await tx.chatRoomMessage.update({
      where: { id: responseMessageId },
      data: { deletedAt: new Date() },
    });
    return;
  }
  const startedAtMs = (turn.startedAt ?? turn.createdAt).getTime();
  const endedAtMs = (turn.completedAt ?? new Date()).getTime();

  if (succeeded) {
    const claimed = await tx.chatRoomMention.updateMany({
      where: { id: mention.id, status: { in: ["pending", "sent"] } },
      data: { status: "responded", error: null },
    });
    // The transition timestamp is the response's unread clock. Losing or
    // repeated finalizers must preserve both that clock and the response.
    if (claimed.count !== 1) return;
    await tx.chatRoomMessage.update({
      where: { id: responseMessageId },
      data: {
        content: answer,
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
  const claimed = await tx.chatRoomMention.updateMany({
    where: { id: mention.id, status: { in: ["pending", "sent"] } },
    data: { status: "failed", error: error.slice(0, 500) },
  });
  if (claimed.count !== 1) return;
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
}
