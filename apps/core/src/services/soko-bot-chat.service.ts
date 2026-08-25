import type { Prisma } from "@sokosumi/database";
import { composeSokoBotIntroduction } from "@sokosumi/soko-bot";
import { getFirstName } from "@sokosumi/utils";

import prisma from "@/lib/db/prisma";

/**
 * Soko Bot in chat. The bot is represented by a first-party `Coworker` row
 * (`Coworker.sokoBotId`) so it rides every existing chat rail: room
 * membership, mentions, the sender FK, realtime, and the live-Thought
 * placeholder. Only dispatch differs: a mention starts a Soko Bot turn and
 * the turn's outcome is written back here.
 */

const SOKOSUMI_VENDOR_SLUG = "sokosumi";
const SOKO_BOT_DEFAULT_NAME = "Soko Bot";
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
  scratch_read: "Reading notes",
  scratch_write: "Writing notes",
  scratch_list: "Listing notes",
};

export function sokoBotCapabilityLabel(toolName: string | null): string {
  if (!toolName) return "Working";
  return CAPABILITY_LABELS[toolName] ?? toolName.replaceAll("_", " ");
}

export function sokoBotCoworkerSlug(sokoBotId: string): string {
  return `soko-bot-${sokoBotId.replaceAll("-", "").slice(0, 12)}`;
}

/**
 * Create or refresh the chat-facing coworker row for a bot. Idempotent; call
 * on bot create, rename, reactivation, and archive.
 */
export async function ensureSokoBotCoworker(
  sokoBotId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<{ id: string; slug: string }> {
  const bot = await tx.sokoBot.findUniqueOrThrow({
    where: { id: sokoBotId },
    select: {
      id: true,
      name: true,
      archivedAt: true,
      avatarImageUrl: true,
      user: { select: { name: true } },
    },
  });
  const ownerFirstName = getFirstName(bot.user.name) ?? null;
  const vendor = await tx.vendor.upsert({
    where: { slug: SOKOSUMI_VENDOR_SLUG },
    create: { slug: SOKOSUMI_VENDOR_SLUG, name: "Sokosumi" },
    update: {},
    select: { id: true },
  });
  const data = {
    name: bot.name?.trim() || SOKO_BOT_DEFAULT_NAME,
    // Teammates can talk to it, so the roster says whose assistant it is.
    caption: ownerFirstName
      ? `${ownerFirstName}'s personal assistant`
      : "Personal assistant",
    image: bot.avatarImageUrl,
    description:
      "Your personal project manager: delegates Tasks to Coworkers and hires Agents.",
    baseURL: `soko-bot://${bot.id}`,
    capabilities: ["chat"],
    isWhitelisted: false,
    archivedAt: bot.archivedAt,
  };
  return tx.coworker.upsert({
    where: { sokoBotId: bot.id },
    create: {
      ...data,
      slug: sokoBotCoworkerSlug(bot.id),
      sokoBotId: bot.id,
      vendorId: vendor.id,
    },
    update: data,
    select: { id: true, slug: true },
  });
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
}

async function publishRealtime(
  messageId: string,
  eventType: "update" | "mention_status",
): Promise<void> {
  const { publishChatRoomMessageRealtimeById } = await import(
    "@/helpers/chat-room-message-realtime"
  );
  await publishChatRoomMessageRealtimeById(messageId, eventType);
}

async function loadChatLinkedTurn(turnId: string): Promise<
  | (ChatLinkedTurn & {
      mention: { id: string; messageId: string; roomId: string } | null;
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
      name: true,
      user: { select: { name: true } },
      coworker: { select: { id: true } },
    },
  });
  if (!bot?.coworker) throw new SokoBotIntroductionError("Soko Bot not found");
  const coworkerId = bot.coworker.id;
  const room = await prisma.chatRoom.findFirst({
    where: {
      id: input.roomId,
      kind: "direct",
      coworkerMembers: { some: { coworkerId } },
      userMembers: { some: { userId: input.userId } },
    },
    select: { id: true },
  });
  if (!room) throw new SokoBotIntroductionError("Direct room not found");
  const existing = await prisma.chatRoomMessage.findFirst({
    where: { roomId: room.id, senderCoworkerId: coworkerId },
    select: { id: true },
  });
  if (existing) return { messageId: existing.id };
  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.chatRoomMessage.create({
      data: {
        roomId: room.id,
        senderCoworkerId: coworkerId,
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

export async function finalizeSokoBotChatTurn(turnId: string): Promise<void> {
  const turn = await loadChatLinkedTurn(turnId);
  if (!turn?.mention || !turn.chatResponseMessageId) return;
  lastProgressPublishAt.delete(turn.chatResponseMessageId);
  const mention = turn.mention;
  const responseMessageId = turn.chatResponseMessageId;

  const answer = turn.finalAnswer?.trim() ?? "";
  const succeeded = turn.status === "COMPLETED" && answer.length > 0;
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
