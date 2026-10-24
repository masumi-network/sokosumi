import { isPersonalSokoBot } from "@/helpers/soko-bot-kind";
import prisma from "@/lib/db/prisma";
import { readQuoteFromMetadata } from "@/routes/v1/chats/rooms/helpers";
import {
  ACTIVE_TURN_STATUSES,
  FOREGROUND_TURN,
  SokoBotTurnInProgressError,
  sokoBotControlPlane,
} from "@/services/soko-bot-control-plane.service";

import {
  buildDirectMessagePrompt,
  buildRoomMentionPrompt,
  loadRoomContextMessages,
  roomMessagePromptText,
  withAttachmentNote,
} from "./chat-room-mention-context";
import {
  claimMentionForDispatch,
  markMentionFailed,
} from "./chat-room-mention-state";
import {
  failMentionWithCoworkerShell,
  publishMentionThoughtPlaceholder,
} from "./chat-room-mention-stream";

/**
 * Accepting a Soko Bot turn — classify, build the context packet, insert the
 * row — happens before any turn exists to look at. When that stalled, the
 * invocation was killed with the placeholder still spinning and nothing in the
 * admin overview to explain it, because there was no turn. Bounded so the
 * owner gets a failed reply instead of a "Thinking…" that never ends.
 */
const SOKO_BOT_ACCEPT_TIMEOUT_MS = 60_000;
/**
 * A message sent while the bot is still answering the previous one waits for
 * that turn instead of failing: "actually, give it to research instead" a few
 * seconds after a request is the owner steering, and used to get no reply.
 */
export const SOKO_BOT_WAIT_FOR_RUNNING_TURN_MS = 120_000;
const RUNNING_TURN_POLL_MS = 2_000;

export async function acceptOnceIdle<T>(
  accept: () => Promise<T>,
  sokoBotId: string,
  options: { waitMs?: number; pollMs?: number } = {},
): Promise<T> {
  const deadline =
    Date.now() + (options.waitMs ?? SOKO_BOT_WAIT_FOR_RUNNING_TURN_MS);
  const pollMs = options.pollMs ?? RUNNING_TURN_POLL_MS;
  for (;;) {
    try {
      return await accept();
    } catch (error) {
      if (!(error instanceof SokoBotTurnInProgressError)) throw error;
      if (Date.now() >= deadline) throw error;
    }
    // Poll the turn row, not the start path: each start classifies the
    // message again.
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      const running = await prisma.sokoBotTurn.findFirst({
        where: {
          sokoBotId,
          ...FOREGROUND_TURN,
          status: { in: [...ACTIVE_TURN_STATUSES] },
        },
        select: { id: true },
      });
      if (!running) break;
    }
  }
}
/**
 * A mention of the owner's Soko Bot starts a Soko Bot turn instead of a
 * remote coworker stream. The Thought placeholder is opened here; the
 * control plane mirrors tool progress into it and writes the answer back
 * when the turn settles (see `soko-bot-chat.service.ts`).
 */
export async function runSokoBotMentionDispatch(params: {
  mentionId: string;
  mention: {
    message: {
      id: string;
      roomId: string;
      parentMessageId: string | null;
      content: string;
      metadata: unknown;
      senderUser: { id: string; name: string | null } | null;
      createdAt: Date;
      room: {
        id: string;
        kind: string;
        name: string | null;
        organizationId: string | null;
      };
    };
    responseMessageId: string | null;
    sokoBot: {
      id: string;
      userId: string | null;
      workspaceId: string;
      archivedAt: Date | null;
    } | null;
    sokoBotId: string | null;
  };
  userId: string;
  failWithShell: (error: unknown) => Promise<void>;
  askedByBot: boolean;
  chainDepth: number;
}): Promise<void> {
  const { mentionId, mention, userId, failWithShell, askedByBot, chainDepth } =
    params;
  const bot = mention.sokoBot;
  if (!bot || bot.archivedAt) {
    await failWithShell("This Soko Bot is no longer active");
    return;
  }
  // Teammates may talk to the bot in organization rooms, direct chats
  // included; the turn runs as the owner (their bot, their credits, their
  // tools), and the console shows who asked. Personal rooms stay owner-only.
  // A shared bot has no owner: its turn runs as the member who asked.
  const isOwner =
    isPersonalSokoBot(bot) && bot.userId === userId && !askedByBot;
  if (!isOwner && !mention.message.room.organizationId) {
    await failWithShell("Only the owner can message this assistant here");
    return;
  }
  const membership = await prisma.chatRoomSokoBotMember.findUnique({
    where: {
      roomId_sokoBotId: {
        roomId: mention.message.roomId,
        sokoBotId: bot.id,
      },
    },
    select: { id: true },
  });
  if (!membership) {
    await failWithShell("Soko Bot is no longer a member of this room");
    return;
  }
  const claimed = await claimMentionForDispatch(mentionId);
  if (!claimed) return;

  const startedAtMs = Date.now();
  let placeholderId: string | null = mention.responseMessageId;
  try {
    placeholderId = await publishMentionThoughtPlaceholder({
      placeholderId,
      roomId: mention.message.roomId,
      parentMessageId: mention.message.parentMessageId,
      sourceMessageId: mention.message.id,
      mentionId,
      sokoBotId: bot.id,
      reasoningSteps: [],
      thoughtStartedAtMs: startedAtMs,
    });
  } catch (publishError) {
    console.error("Soko Bot Thought placeholder create failed:", {
      mentionId,
      error: publishError,
    });
  }
  if (!placeholderId) {
    // The create may have committed with its acknowledgement lost, leaving a
    // bubble streaming that this worker never learned the id of. Marking the
    // mention failed without adopting it is how a placeholder outlives every
    // other signal, so look before giving up.
    const committed = await prisma.chatRoomMention.findUnique({
      where: { id: mentionId },
      select: { responseMessageId: true },
    });
    placeholderId = committed?.responseMessageId ?? null;
  }
  if (!placeholderId) {
    await markMentionFailed(mentionId, "Could not open the reply");
    return;
  }

  // From here the caller's closure is stale: it captured the mention's
  // responseMessageId before this placeholder existed, so failing through it
  // would open a second bubble and leave this one streaming for ever — the
  // shape of the "Thinking…" messages that never ended.
  const failPlaceholder = (error: unknown) =>
    failMentionWithCoworkerShell({
      mentionId,
      sourceMessageId: mention.message.id,
      roomId: mention.message.roomId,
      parentMessageId: mention.message.parentMessageId,
      sokoBotId: bot.id,
      existingPlaceholderId: placeholderId,
      error,
    });

  // Every mention carries the conversation right above it, as coworker
  // mentions do. In a direct chat that is the bot's own posts too: inbox
  // checks and briefings are messages there, not turns the owner started.
  const threadRootId = mention.message.parentMessageId;
  // Inside the guard: this reads the room, and a read that throws once left
  // the placeholder above streaming for ever while the mention was marked
  // failed somewhere the reader could not see.
  let message: string;
  try {
    const said = withAttachmentNote(
      roomMessagePromptText(
        mention.message.content,
        readQuoteFromMetadata(mention.message.metadata),
      ),
      mention.message.content,
    );
    const contextMessages = await loadRoomContextMessages({
      roomId: mention.message.roomId,
      messageId: mention.message.id,
      createdAt: mention.message.createdAt,
      threadRootId,
    });
    message =
      mention.message.room.kind === "direct"
        ? buildDirectMessagePrompt({ content: said, contextMessages })
        : buildRoomMentionPrompt({
            roomName: mention.message.room.name ?? "chat",
            senderName: mention.message.senderUser?.name ?? "A teammate",
            content: said,
            isThreadReply: threadRootId != null,
            contextMessages,
          });
  } catch (error) {
    await failPlaceholder(error);
    return;
  }

  const accept = async () => {
    const accepted = sokoBotControlPlane.startTurn({
      ...(isPersonalSokoBot(bot)
        ? { userId: bot.userId }
        : { userId, sokoBotId: bot.id }),
      // The mentioned bot runs in its own workspace, whatever room it was
      // asked in. The room's workspace ran a different bot of the same owner
      // (their personal one) and put its Tasks there.
      workspaceId: bot.workspaceId,
      clientTurnId: `chat:${mentionId}`,
      message: isOwner
        ? message
        : `${mention.message.senderUser?.name ?? "A teammate"} (${isPersonalSokoBot(bot) ? "a teammate, not your owner" : "a member of the team"}) asked:\n${message}`,
      source: "CHAT",
      chat: {
        mentionId,
        responseMessageId: placeholderId,
        classifyMessage: message,
        askedByUserId: isOwner && !askedByBot ? null : userId,
        askedByBot,
        chainDepth,
      },
    });
    let acceptTimer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      accepted,
      new Promise<never>((_resolve, reject) => {
        acceptTimer = setTimeout(
          () =>
            reject(new Error("Soko Bot took too long to accept the message")),
          SOKO_BOT_ACCEPT_TIMEOUT_MS,
        );
      }),
    ]).finally(() => {
      if (acceptTimer) clearTimeout(acceptTimer);
    });
  };

  try {
    const result = await acceptOnceIdle(accept, bot.id);
    if (
      result.reconciliationLeaseToken &&
      (result.status === "STARTING" || result.status === "RUNNING")
    ) {
      await sokoBotControlPlane.reconcileTurn(
        result.turnId,
        undefined,
        result.reconciliationLeaseToken,
      );
    }
  } catch (error) {
    await failPlaceholder(error);
  }
}
