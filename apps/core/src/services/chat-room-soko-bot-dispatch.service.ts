import { invalidateChatRoomMessageReaders } from "@/helpers/chat-room-message-created-effects";
import { publishChatRoomMessageRealtimeById } from "@/helpers/chat-room-message-realtime";
import { isPersonalSokoBot } from "@/helpers/soko-bot-kind";
import prisma from "@/lib/db/prisma";
import { readQuoteFromMetadata } from "@/routes/v1/chats/rooms/helpers";
import { persistSokoBotChatTurn } from "@/services/soko-bot-chat.service";
import {
  ACTIVE_TURN_STATUSES,
  FOREGROUND_TURN,
  SokoBotTurnInProgressError,
  sokoBotControlPlane,
} from "@/services/soko-bot-control-plane.service";
import { deliverSokoBotTurnOutbox } from "@/services/soko-bot-delivery.service";

import {
  buildDirectMessagePrompt,
  buildRoomMentionPrompt,
  loadRoomContextMessages,
  roomMessagePromptText,
  withAttachmentNote,
} from "./chat-room-mention-context";
import {
  claimMentionForDispatch,
  failSokoBotReplyIfOwned,
  findSokoBotReplyOpenedBy,
  openSokoBotReply,
} from "./chat-room-mention-state";

/**
 * Fails a Soko Bot mention only where `failSokoBotReplyIfOwned` allows, then
 * publishes the failed card. `stamp` is the stamp of a claim this worker
 * acquired (`claimMentionForDispatch`), never one it merely read: a read of a
 * `sent` row can see another worker's live claim. Every Soko Bot failure goes
 * through here (before the claim via `failUnclaimedSokoBotMention`).
 */
export async function failSokoBotMention(
  mentionId: string,
  stamp: Date,
  error: unknown,
): Promise<void> {
  const failed = await failSokoBotReplyIfOwned({ mentionId, stamp, error });
  if (!failed) return;
  if (failed.eventType === "create") {
    const reply = await prisma.chatRoomMessage.findUnique({
      where: { id: failed.replyId },
      select: { roomId: true },
    });
    if (reply)
      await invalidateChatRoomMessageReaders({ roomId: reply.roomId }).catch(
        () => undefined,
      );
  }
  await publishChatRoomMessageRealtimeById(failed.replyId, failed.eventType);
}

/**
 * A failure found before this worker claimed the mention (the bot is gone,
 * the room changed, a lookup threw). The worker claims first, as a dispatch
 * would: a `pending` mention, or a stale `sent` one whose worker died, is
 * then failed under that claim. A mention another worker is live on stays
 * with that worker, which settles it itself.
 */
export async function failUnclaimedSokoBotMention(
  mentionId: string,
  error: unknown,
): Promise<void> {
  const claim = await claimMentionForDispatch(mentionId);
  if (claim) await failSokoBotMention(mentionId, claim.stamp, error);
}

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

function isActiveTurnStatus(status: string): boolean {
  return (ACTIVE_TURN_STATUSES as readonly string[]).includes(status);
}

/**
 * Puts an ended turn's outcome back on its reply.
 *
 * A delivery still open is pushed first, but it cannot be relied on to close
 * the reply: one already PERSISTED only publishes what the message holds now,
 * and one in backoff or leased elsewhere does nothing here. So the outcome is
 * always reapplied after: a completed turn's answer through the shared chat
 * write (a no-op once the mention answered), a failed or cancelled one as the
 * failed card, terminal and retryable, only while the turn still owns the
 * mention (`failSokoBotReplyIfOwned`). The turn keeps the mention until its
 * delivery finishes; Retry then starts a fresh turn
 * (`releaseFailedTurnForRetry`).
 */
async function settleEndedTurn(
  turnId: string,
  status: string,
  failPlaceholder: (error: unknown) => Promise<void>,
): Promise<void> {
  const open = await prisma.sokoBotDelivery.findFirst({
    where: { turnId, status: { in: ["PENDING", "PERSISTED"] } },
    select: { id: true },
  });
  if (open) {
    await deliverSokoBotTurnOutbox(turnId).catch((error: unknown) => {
      console.error("Soko Bot delivery push failed:", { turnId, error });
    });
  }
  if (status !== "COMPLETED") {
    await failPlaceholder(new Error(`Soko Bot turn ${status.toLowerCase()}`));
    return;
  }
  const reply = await prisma.$transaction(async (tx) => {
    await persistSokoBotChatTurn(turnId, tx);
    return tx.sokoBotTurn.findUnique({
      where: { id: turnId },
      select: {
        chatResponseMessageId: true,
        chatMention: { select: { messageId: true } },
      },
    });
  });
  if (reply?.chatResponseMessageId)
    await publishChatRoomMessageRealtimeById(
      reply.chatResponseMessageId,
      "update",
    );
  if (reply?.chatMention)
    await publishChatRoomMessageRealtimeById(
      reply.chatMention.messageId,
      "mention_status",
    );
}

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
    responseMessage?: { metadata: unknown } | null;
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
  const claim = await claimMentionForDispatch(mentionId);
  if (!claim) return;

  // This attempt: the key its turn runs under, its reply, and its claim's
  // stamp (`failSokoBotReplyIfOwned`), which the mention keeps until another
  // claim, a stale reclaim or Retry rewrites it.
  let clientTurnId = `chat:${mentionId}`;
  let replyId = mention.responseMessageId;
  // From here the caller's closure is stale: it captured the mention's
  // responseMessageId before this placeholder existed, so failing through it
  // would open a second bubble and leave this one streaming for ever — the
  // shape of the "Thinking…" messages that never ended.
  // Every failure past the claim ends here. It writes only what this worker
  // may: a turn holding the mention is failed only by its own failure, and
  // before any turn only while the claim is still this worker's.
  const failReply = (error: unknown) =>
    failSokoBotMention(mentionId, claim.stamp, error);

  try {
    // The key this start runs under. The turn holding the mention keeps it:
    // a reclaimed dispatch resumes that turn (and its delivery) instead of
    // running the request again. Only an explicit Retry lets go of a failed
    // turn (`releaseFailedTurnForRetry`); the next attempt is then keyed by
    // the newest turn it follows, so workers that see the same predecessor
    // share one key. Newest by key, not by link: a retry whose start threw
    // left no turn, and the original still holds `chat:<id>`.
    const [newest] = await prisma.sokoBotTurn.findMany({
      where: { sokoBotId: bot.id, clientTurnId: { startsWith: clientTurnId } },
      orderBy: { createdAt: "desc" },
      take: 1,
      select: {
        id: true,
        clientTurnId: true,
        chatMentionId: true,
        status: true,
      },
    });
    const holder = newest?.chatMentionId === mentionId ? newest : null;
    if (holder) clientTurnId = holder.clientTurnId;
    else if (newest) clientTurnId = `chat:${mentionId}:retry:${newest.id}`;
    // A turn that already ended still holds the mention (stale reclaim, or
    // Retry while its delivery was owed): put its outcome back without
    // reopening the reply. A reopened "Thinking…" is a snapshot a concurrent
    // publisher of that delivery could read and send after the outcome.
    if (holder && !isActiveTurnStatus(holder.status)) {
      await settleEndedTurn(holder.id, holder.status, failReply);
      return;
    }
    // Only a new attempt opens the reply. A turn holding the mention is
    // already writing it, and may end at any moment: a reopened "Thinking…"
    // read by a publisher then would land after its outcome.
    if (!holder) {
      const opened = await openSokoBotReply({
        mentionId,
        stamp: claim.stamp,
        reclaimed: claim.reclaimed,
      }).catch(async (openError: unknown) => {
        // The open may have committed with its acknowledgement lost, leaving a
        // bubble streaming that this worker never learned the id of. Marking the
        // mention failed without adopting it is how a placeholder outlives every
        // other signal, so look before giving up.
        console.error("Soko Bot Thought placeholder create failed:", {
          mentionId,
          error: openError,
        });
        const committed = await findSokoBotReplyOpenedBy(
          mentionId,
          claim.stamp,
        );
        // Not opened by this claim: fail it under the ownership check rather
        // than start a turn on a reply this attempt never opened.
        return committed
          ? { replyId: committed, eventType: "update" as const }
          : undefined;
      });
      // Another claim, a stale reclaim or Retry owns the mention now: this
      // worker's attempt is over and writes nothing more.
      if (opened === null) return;
      replyId = opened?.replyId ?? null;
      if (opened?.eventType === "create")
        await Promise.all([
          invalidateChatRoomMessageReaders({ roomId: mention.message.roomId }),
          publishChatRoomMessageRealtimeById(opened.replyId, "create"),
        ]).catch((publishError: unknown) => {
          console.error("Soko Bot Thought placeholder publish failed:", {
            mentionId,
            error: publishError,
          });
        });
      else if (opened?.eventType === "update")
        await publishChatRoomMessageRealtimeById(opened.replyId, "update");
    }
    if (!replyId) throw new Error("Could not open the reply");
    const responseMessageId = replyId;

    // Every mention carries the conversation right above it, as coworker
    // mentions do. In a direct chat that is the bot's own posts too: inbox
    // checks and briefings are messages there, not turns the owner started.
    const threadRootId = mention.message.parentMessageId;
    // Inside the guard: this reads the room, and a read that throws once left
    // the placeholder above streaming for ever while the mention was marked
    // failed somewhere the reader could not see.
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
    const message =
      mention.message.room.kind === "direct"
        ? buildDirectMessagePrompt({ content: said, contextMessages })
        : buildRoomMentionPrompt({
            roomName: mention.message.room.name ?? "chat",
            senderName: mention.message.senderUser?.name ?? "A teammate",
            content: said,
            isThreadReply: threadRootId != null,
            contextMessages,
          });

    const accept = async () => {
      const accepted = sokoBotControlPlane.startTurn({
        sokoBotId: bot.id,
        userId: isPersonalSokoBot(bot) ? bot.userId : userId,
        // The mentioned bot runs in its own workspace, whatever room it was
        // asked in. The room's workspace ran a different bot of the same owner
        // (their personal one) and put its Tasks there.
        workspaceId: bot.workspaceId,
        clientTurnId,
        message: isOwner
          ? message
          : `${mention.message.senderUser?.name ?? "A teammate"} (${isPersonalSokoBot(bot) ? "a teammate, not your owner" : "a member of the team"}) asked:\n${message}`,
        source: "CHAT",
        chat: {
          mentionId,
          responseMessageId,
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

    const result = await acceptOnceIdle(accept, bot.id);
    // A turn that already ended answers through its own outcome: a
    // completed one may still be delivering, and failing the reply here
    // would turn a good answer into a failed card.
    if (result.duplicate && !isActiveTurnStatus(result.status)) {
      await settleEndedTurn(result.turnId, result.status, failReply);
      return;
    }
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
    // If even the checked write fails, write nothing: an unchecked write could
    // fail a newer attempt or a completed turn and discard its answer. The
    // mention stays `sent` for stale reclaim to settle.
    await failReply(error).catch((fenceError: unknown) => {
      console.error("Soko Bot reply failure left for reclaim:", {
        mentionId,
        error,
        fenceError,
      });
    });
  }
}
