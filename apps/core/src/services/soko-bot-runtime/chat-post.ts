import { type Prisma } from "@sokosumi/database";
import {
  type ChatResultReference,
  getSokoBotVersion,
} from "@sokosumi/soko-bot";
import { RESULT_SNAPSHOTS_KEY } from "@/helpers/chat-result-metadata";
import { sokoBotDisplayName } from "@/helpers/soko-bot-display-name";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import { commitActionReceipt } from "@/lib/soko-bot/action-receipts";
import {
  chatChainMayWake,
  MAX_CHAT_CHAIN_DEPTH,
  nextChatChainDepth,
  ROOM_BOT_MESSAGE_WINDOW_MS,
  ROOM_BOT_MESSAGES_PER_HOUR,
} from "@/lib/soko-bot/chat-chain";
import {
  persistedToolResult,
  sanitizePersistedValue,
} from "@/lib/soko-bot/persisted-value";
import {
  resolveMentionedCoworkerIds,
  resolveMentionedSokoBotIds,
} from "@/routes/v1/chats/rooms/helpers";
import { resolveChatResultReference } from "@/services/chat-result-preview.service";
import { approvedMarketingStrategy } from "@/services/marketing-strategy.service";
import { enqueueSokoBotEffect } from "@/services/soko-bot-effect-outbox.service";
import {
  type AuthorizedSokoBotRuntime,
  SokoBotRuntimeAuthorizationError,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";
import { actingMemberOf } from "./acting-scope";
import { type RuntimeOperations } from "./operations";

/**
 * A direct room is permanent — nobody can leave or archive one — so being in
 * it must not become standing permission to write in it.
 *
 * `open_direct_chat` is deliberately limited to turns the owner asked for.
 * The room it leaves behind outlived that limit: every later schedule,
 * ingest or event turn found the room through `list_chats` and could reach
 * that colleague again with nobody having asked for it. One instruction to
 * write to Nina became a standing licence to keep writing to her.
 *
 * The owner's own direct is exempt, because briefing them there unprompted
 * is the entire point of a scheduled turn. Channels are exempt too: a person
 * can leave or mute one, and a bot added to a project room is expected to
 * speak in it.
 */
export async function requireUnattendedPostIsAllowed(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  room: { id: string; kind: string },
  client: Prisma.TransactionClient = prisma,
) {
  if (authorized.turn.source === "CHAT" || room.kind !== "direct") {
    return;
  }
  // A turn that acts for nobody has no owner in any direct room.
  const { actingUserId } = authorized.turn;
  const ownerIsMember =
    actingUserId !== null &&
    (await client.chatRoomUserMember.findFirst({
      where: { roomId: room.id, userId: actingUserId },
      select: { id: true },
    }));
  if (!ownerIsMember) {
    throw new SokoBotRuntimeAuthorizationError(
      "Writing to a colleague is for turns your owner asked for. Raise it in your owner's chat instead.",
    );
  }
}

/** Post into a room the bot belongs to, as the bot's Soko Bot identity. */
export async function postChat(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  input: {
    roomId: string;
    content: string;
    toolCallId: string;
    resultReferences?: ChatResultReference[];
    /** The tool that posted when it was not post_chat, and what it adds to the result. */
    via?: {
      capability: "open_direct_chat" | "ask_coworker";
      result: Record<string, unknown>;
    };
    publicationId?: string;
  },
  transaction?: Prisma.TransactionClient,
) {
  if (input.resultReferences?.length && authorized.askedByKind !== "OWNER") {
    throw new SokoBotRuntimeAuthorizationError(
      "Result previews are prepared for the owner's requests",
    );
  }
  const snapshots: Awaited<ReturnType<typeof resolveChatResultReference>>[] =
    [];
  for (const reference of input.resultReferences ?? []) {
    snapshots.push(
      await resolveChatResultReference({
        reference,
        actor: {
          userId: actingMemberOf(authorized),
          workspaceId: authorized.turn.workspaceId,
          kind: "soko_bot",
        },
      }),
    );
  }
  const persist = async (tx: Prisma.TransactionClient) => {
    await runtime.requireMutationAuthority(
      tx,
      authorized,
      false,
      input.via?.capability ?? "post_chat",
    );
    // A turn another assistant started may answer only where it was asked.
    // Unreachable while the bot-to-bot ceiling withholds `post_chat` — kept
    // because it is the guard that would matter the moment that ceiling is
    // widened again, and the failure it prevents is silent: text from the
    // requesting bot naming a room its own owner cannot see, and this bot
    // posting there on its behalf.
    if (authorized.turn.chainDepth > 0) {
      const origin = await tx.sokoBotTurn.findUnique({
        where: { id: authorized.turn.id },
        select: {
          chatMention: { select: { message: { select: { roomId: true } } } },
        },
      });
      const originRoomId = origin?.chatMention?.message.roomId;
      if (!originRoomId || originRoomId !== input.roomId) {
        throw new SokoBotRuntimeAuthorizationError(
          "You may only reply in the room you were asked in",
        );
      }
    }
    const room = await runtime.requireChatMembership(
      authorized,
      input.roomId,
      tx,
    );
    await runtime.requireUnattendedPostIsAllowed(authorized, room, tx);
    // Who this post summons. A bot may address another bot, but every hop is
    // counted: past the ceiling the message still posts and simply stops being
    // a summons, so an unattended exchange cannot run for ever.
    const chainDepth = nextChatChainDepth(authorized.turn.chainDepth);
    // Backstop the hop counter cannot provide: it reasons pairwise, so three
    // bots in a triangle could defeat it. This does not care who produced the
    // traffic, only how much of it a room has taken lately.
    const roomCoworkers = chatChainMayWake(chainDepth)
      ? await tx.chatRoomCoworkerMember.findMany({
          where: { roomId: room.id },
          select: {
            coworker: { select: { id: true, name: true, slug: true } },
          },
        })
      : [];
    const roomSokoBots = chatChainMayWake(chainDepth)
      ? await tx.chatRoomSokoBotMember.findMany({
          where: {
            roomId: room.id,
            sokoBotId: { not: room.sokoBotId },
          },
          select: {
            sokoBot: { select: { id: true, name: true } },
          },
        })
      : [];
    const mentionedCoworkerIds = resolveMentionedCoworkerIds({
      content: input.content,
      roomCoworkers: roomCoworkers.map(({ coworker }) => coworker),
    });
    const mentionedSokoBotIds = resolveMentionedSokoBotIds({
      content: input.content,
      roomSokoBots: roomSokoBots.map(({ sokoBot }) => ({
        id: sokoBot.id,
        name: sokoBotDisplayName({ name: sokoBot.name }),
      })),
    });
    // A chat turn's answer already appears where it was asked, in the thread
    // when it was asked in one. Posting it into that room as well put the
    // same answer in the thread and in the channel. A post that summons a
    // Coworker or another assistant is a message of its own and still goes.
    if (
      !input.via &&
      !input.publicationId &&
      authorized.turn.source === "CHAT" &&
      authorized.turn.chainDepth === 0 &&
      mentionedCoworkerIds.length === 0 &&
      mentionedSokoBotIds.length === 0
    ) {
      const asked = await tx.sokoBotTurn.findUnique({
        where: { id: authorized.turn.id },
        select: {
          chatMention: { select: { message: { select: { roomId: true } } } },
        },
      });
      if (asked?.chatMention?.message.roomId === room.id) {
        throw new SokoBotRuntimeValidationError(
          "Your answer to this message is posted for you in this chat, in the thread when you were asked in one, so write it as your answer. Post here yourself only to tag a Coworker or another assistant.",
        );
      }
    }
    // Queue unreadable content and inert mentions. The outbox activates both
    // only after rechecking the exact audience at the publication boundary.
    let replayedPublication = false;
    const message = await (async () => {
      if (input.publicationId) {
        const existing = await tx.chatRoomMessage.findFirst({
          where: {
            id: input.publicationId,
            roomId: room.id,
            senderSokoBotId: room.sokoBotId,
          },
          select: { id: true, createdAt: true },
        });
        if (existing) {
          replayedPublication = true;
          return existing;
        }
      }
      // Counted inside the transaction: read outside it, two bots posting at
      // once both see room for one more and the room takes both.
      const botMessagesThisHour = await tx.chatRoomMessage.count({
        where: {
          roomId: room.id,
          OR: [
            { senderCoworkerId: { not: null } },
            { senderSokoBotId: { not: null } },
          ],
          createdAt: {
            gte: new Date(Date.now() - ROOM_BOT_MESSAGE_WINDOW_MS),
          },
        },
      });
      if (botMessagesThisHour >= ROOM_BOT_MESSAGES_PER_HOUR) {
        throw new SokoBotRuntimeValidationError(
          `This room has taken ${botMessagesThisHour} assistant messages in the last hour and is rate limited. Say nothing further here for now.`,
        );
      }
      const created = await tx.chatRoomMessage.create({
        data: {
          roomId: room.id,
          ...(input.publicationId ? { id: input.publicationId } : {}),
          clientMessageId: `soko-bot-tool:${authorized.turn.id}:${input.toolCallId}`,
          senderSokoBotId: room.sokoBotId,
          content: "",
          deletedAt: new Date(),
          // Lets the reader see, on hover, that this is part of an assistant
          // exchange and how close it is to the point where it stops.
          metadata: {
            ...(snapshots.length
              ? { [RESULT_SNAPSHOTS_KEY]: sanitizePersistedValue(snapshots) }
              : {}),
            soko_bot_chain: {
              depth: chainDepth,
              max_depth: MAX_CHAT_CHAIN_DEPTH,
              room_messages_this_hour: botMessagesThisHour + 1,
              room_messages_per_hour: ROOM_BOT_MESSAGES_PER_HOUR,
            },
          },
        },
        select: { id: true, createdAt: true },
      });
      if (mentionedCoworkerIds.length > 0 || mentionedSokoBotIds.length > 0) {
        await tx.chatRoomMention.createMany({
          data: [
            ...mentionedCoworkerIds.map((coworkerId) => ({
              messageId: created.id,
              coworkerId,
              sokoBotId: null,
              chainDepth,
              status: "staged",
            })),
            ...mentionedSokoBotIds.map((sokoBotId) => ({
              messageId: created.id,
              coworkerId: null,
              sokoBotId: sokoBotId,
              chainDepth,
              status: "staged",
            })),
          ],
          skipDuplicates: true,
        });
      }
      await tx.chatRoom.update({
        where: { id: room.id },
        data: { updatedAt: new Date() },
      });
      return created;
    })();
    const result = {
      messageId: message.id,
      roomId: room.id,
      queuedAt: message.createdAt.toISOString(),
      queuedMentions: mentionedCoworkerIds.length + mentionedSokoBotIds.length,
      deliveryStatus: "QUEUED",
      ...input.via?.result,
    };
    const receipt = await commitActionReceipt(tx, {
      turnId: authorized.turn.id,
      toolCallId: input.toolCallId,
      actorBotId: authorized.turn.sokoBotId,
      targetId: message.id,
      effectEventId: message.id,
      result: persistedToolResult(result),
    });
    if (replayedPublication) return result;
    const audience = await tx.chatRoom.findUniqueOrThrow({
      where: { id: room.id },
      select: {
        userMembers: { select: { userId: true } },
        coworkerMembers: { select: { coworkerId: true } },
        sokoBotMembers: { select: { sokoBotId: true } },
      },
    });
    await enqueueSokoBotEffect(tx, {
      receiptId: receipt.id,
      purpose: "CHAT_MESSAGE",
      payload: {
        messageId: message.id,
        roomId: room.id,
        content: input.content,
        userIds: audience.userMembers.map((m) => m.userId).sort(),
        coworkerIds: audience.coworkerMembers.map((m) => m.coworkerId).sort(),
        botIds: audience.sokoBotMembers.map((m) => m.sokoBotId).sort(),
      },
    });
    return result;
  };
  return transaction
    ? persist(transaction)
    : serializableTransaction(
        persist,
        "Another assistant posted into this room at the same moment",
      );
}

/**
 * Everything that can refuse an image before anything is sent: an owner
 * chat turn, a Project the owner can open, and a price within maxCredits.
 * `executeTool` runs it before the external-effect reservation, so a
 * refusal is recorded as rejected rather than as an unknown outcome.
 */
/**
 * Spending credits on media and replying in the brand's name need a person
 * asking in chat. Cuso's own routines are the exception once the owner
 * approved his plan: it lists the media, and the daily run makes it and
 * answers comments.
 */
export async function mayActForOwner(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
): Promise<boolean> {
  const { turn } = authorized;
  if (
    turn.source === "CHAT" &&
    turn.chainDepth === 0 &&
    authorized.askedByKind !== "ASSISTANT"
  )
    return true;
  // Cuso's own rhythms and the month's production run (an EVENT run Core
  // starts after approval) act once the owner approved the plan.
  if (
    (turn.source !== "SCHEDULE" && turn.source !== "EVENT") ||
    getSokoBotVersion(turn.versionId).profile !== "cmo"
  )
    return false;
  const bot = await prisma.sokoBot.findUnique({
    where: { id: turn.sokoBotId },
    select: { projectId: true },
  });
  return (
    !!bot?.projectId &&
    (await approvedMarketingStrategy(bot.projectId)) !== null
  );
}
