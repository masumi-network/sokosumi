import { HTTPException } from "hono/http-exception";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  addressCoworkers,
  createOrGetCoworkerQuestionRoom,
} from "@/lib/soko-bot/coworker-question-room";
import {
  ambiguousDirectChatTargetMessage,
  directChatMemberWhere,
  directChatNeedle,
  SHARED_SOKO_BOT_NO_DIRECTS,
} from "@/lib/soko-bot/direct-chat-target";
import {
  resolveMentionedCoworkerIds,
  validateChatCoworkerIds,
} from "@/routes/v1/chats/rooms/helpers";
import {
  type AuthorizedSokoBotRuntime,
  SokoBotRuntimeAuthorizationError,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";
import { actingMemberOf } from "./acting-scope";
import {
  MAX_COWORKER_QUESTIONS_PER_TURN,
  MAX_DIRECTS_OPENED_PER_TURN,
} from "./execution-limits";
import { type RuntimeOperations } from "./operations";

/**
 * Opens (or returns) the bot's direct room with one person in its owner's
 * organization, so it can reach a colleague it does not already share a room
 * with. Nobody can leave or archive a direct room — its participant set is
 * its identity — so an unwanted one is permanent, which is why opening one
 * is bounded rather than merely discouraged.
 *
 * Deliberately narrow. The target must be a member of the organization the
 * turn runs in — a bot must not be able to start a conversation with someone
 * outside the workspace it lives in — and it can never be another assistant:
 * a room with no person in it is one where a runaway is invisible.
 */
export async function openDirectChat(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  input: { person: string; message: string; toolCallId: string },
) {
  // Approaching somebody is the owner's call. A turn nobody asked for can
  // still say "I would ask Nina about this" in the owner's own chat and let
  // them decide, which costs nothing and embarrasses no one.
  if (authorized.turn.source !== "CHAT" || authorized.turn.chainDepth > 0) {
    throw new SokoBotRuntimeAuthorizationError(
      "Opening a chat with a colleague is for turns your owner asked for. Tell them who you would approach and why instead.",
    );
  }
  if (authorized.reader.sharedScope) {
    throw new SokoBotRuntimeValidationError(SHARED_SOKO_BOT_NO_DIRECTS);
  }
  // A turn may make 64 tool calls or more, so without a bound one instruction could
  // put the bot in front of every member of the organization at once.
  const opened = await prisma.sokoBotToolCall.count({
    where: {
      turnId: authorized.turn.id,
      capability: "open_direct_chat",
      NOT: { toolCallId: input.toolCallId },
    },
  });
  if (opened >= MAX_DIRECTS_OPENED_PER_TURN) {
    throw new SokoBotRuntimeValidationError(
      `One turn may open at most ${MAX_DIRECTS_OPENED_PER_TURN} direct chats. Tell the owner who else you would approach.`,
    );
  }
  const sokoBotId = authorized.turn.sokoBotId;
  const workspace = await prisma.workspace.findUnique({
    where: { id: authorized.turn.workspaceId },
    select: { organizationId: true },
  });
  const organizationId = workspace?.organizationId ?? null;
  if (!organizationId) {
    throw new SokoBotRuntimeValidationError(
      "Direct chats with colleagues need an organization workspace",
    );
  }
  // Resolved from a name or an email, not an opaque id: the packet carries
  // the owner and their coworkers, never the organization's roster, so a
  // tool that demanded a UUID could only ever be called with one that
  // happened to appear in the text — which is to say, almost never.
  const needle = directChatNeedle(input.person);
  // "@" on its own passes the schema and strips to nothing, which would
  // match a member whose display name is blank.
  if (!needle) {
    throw new SokoBotRuntimeValidationError(
      "Name the person to write to. Ask the owner who they mean.",
    );
  }
  const members = await prisma.member.findMany({
    where: directChatMemberWhere(organizationId, needle),
    select: { user: { select: { id: true, name: true, email: true } } },
    take: 5,
  });
  if (members.length === 0) {
    throw new SokoBotRuntimeAuthorizationError(
      `No member of this organization matches "${needle}". Ask the owner who they mean.`,
    );
  }
  if (members.length > 1) {
    throw new SokoBotRuntimeValidationError(
      ambiguousDirectChatTargetMessage(needle, members),
    );
  }
  const member = members[0]!;
  // The owner is reachable in their own direct room; opening a second one
  // would split the conversation in two. A teammate asking the bot to tell
  // its owner something posts there instead.
  if (member.user.id === authorized.turn.actingUserId) {
    const ownerRoom = await prisma.chatRoom.findFirst({
      where: {
        kind: "direct",
        archivedAt: null,
        sokoBotMembers: { some: { sokoBotId } },
        userMembers: { some: { userId: authorized.turn.actingUserId } },
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    if (!ownerRoom || authorized.askedByKind !== "TEAMMATE") {
      throw new SokoBotRuntimeValidationError(
        "You already have a direct chat with your owner",
      );
    }
    return runtime.postChat(authorized, {
      roomId: ownerRoom.id,
      content: input.message,
      toolCallId: input.toolCallId,
    });
  }
  const { createOrGetDirectRoom } = await import(
    "@/routes/v1/chats/rooms/helpers"
  );
  return serializableTransaction(async (tx) => {
    await runtime.requireMutationAuthority(
      tx,
      authorized,
      false,
      "open_direct_chat",
    );
    const stillMember = await tx.member.findFirst({
      where: { organizationId, userId: member.user.id },
      select: { id: true },
    });
    if (!stillMember)
      throw new SokoBotRuntimeAuthorizationError(
        "The person is no longer a workspace member",
      );
    const { room, created } = await createOrGetDirectRoom({
      organizationId,
      currentUserId: member.user.id,
      memberUserIds: [],
      coworkerIds: [],
      sokoBotIds: [sokoBotId],
      sokoBotActorUserId: actingMemberOf(authorized),
      viewerUserId: null,
      transaction: tx,
    });
    return runtime.postChat(
      authorized,
      {
        roomId: room.id,
        content: input.message,
        toolCallId: input.toolCallId,
        via: {
          capability: "open_direct_chat",
          result: {
            name: room.name,
            created,
            withUserName: member.user.name,
          },
        },
      },
      tx,
    );
  }, "Opening the direct chat collided with another operation");
}

/**
 * Asks Coworkers something in a private channel of the owner, the bot and
 * them, before the bot commits work to them. The question is an ordinary
 * mention, so each Coworker answers in the room through the dispatch a
 * person's mention uses, and the bot reads the answer with `read_chat`.
 */
export async function askCoworker(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  input: { coworkerIds: string[]; question: string; toolCallId: string },
) {
  const ownerUserId = authorized.turn.actingUserId;
  // The owner is in the room and reads the answer; a teammate or another
  // assistant asking would put the owner's bot in a room they never see.
  if (
    authorized.turn.source !== "CHAT" ||
    authorized.turn.chainDepth > 0 ||
    authorized.askedByKind === "TEAMMATE" ||
    authorized.askedByKind === "ASSISTANT" ||
    !ownerUserId
  ) {
    throw new SokoBotRuntimeAuthorizationError(
      "Asking a Coworker is for your owner's own requests. Tell them who you would ask and what.",
    );
  }
  if (authorized.reader.sharedScope) {
    throw new SokoBotRuntimeValidationError(
      "A shared Soko Bot has no owner to ask Coworkers with. Create a DRAFT Task with the question instead.",
    );
  }
  const asked = await prisma.sokoBotToolCall.count({
    where: {
      turnId: authorized.turn.id,
      capability: "ask_coworker",
      NOT: { toolCallId: input.toolCallId },
    },
  });
  if (asked >= MAX_COWORKER_QUESTIONS_PER_TURN) {
    throw new SokoBotRuntimeValidationError(
      `One turn may ask Coworkers at most ${MAX_COWORKER_QUESTIONS_PER_TURN} times. Follow up in the rooms you opened with post_chat.`,
    );
  }
  const workspace = await prisma.workspace.findUnique({
    where: { id: authorized.turn.workspaceId },
    select: { organizationId: true },
  });
  const organizationId = workspace?.organizationId;
  if (!organizationId) {
    throw new SokoBotRuntimeValidationError(
      "Asking Coworkers in a group chat needs an organization workspace. Create a DRAFT Task with the question instead.",
    );
  }
  return serializableTransaction(async (tx) => {
    await runtime.requireMutationAuthority(
      tx,
      authorized,
      false,
      "ask_coworker",
    );
    let coworkerIds: string[];
    try {
      coworkerIds = await validateChatCoworkerIds(
        input.coworkerIds,
        authorized.turn.workspaceId,
        tx,
      );
    } catch (error) {
      if (!(error instanceof HTTPException)) throw error;
      throw new SokoBotRuntimeValidationError(
        "Every Coworker you ask must be available here and able to chat; check the ids with find_coworkers. For one who cannot chat, put the question in a DRAFT Task.",
      );
    }
    const found = await tx.coworker.findMany({
      where: { id: { in: coworkerIds } },
      select: { id: true, name: true, slug: true },
    });
    const coworkers = coworkerIds.flatMap(
      (id) => found.find((coworker) => coworker.id === id) ?? [],
    );
    const room = await createOrGetCoworkerQuestionRoom(tx, {
      organizationId,
      ownerUserId,
      sokoBotId: authorized.turn.sokoBotId,
      coworkers,
    });
    return runtime.postChat(
      authorized,
      {
        roomId: room.id,
        content: addressCoworkers(
          input.question,
          coworkers,
          (coworker) =>
            resolveMentionedCoworkerIds({
              content: input.question,
              roomCoworkers: [coworker],
            }).length > 0,
        ),
        toolCallId: input.toolCallId,
        via: {
          capability: "ask_coworker",
          result: { name: room.name, created: room.created, coworkers },
        },
      },
      tx,
    );
  }, "Asking the Coworker collided with another operation");
}
