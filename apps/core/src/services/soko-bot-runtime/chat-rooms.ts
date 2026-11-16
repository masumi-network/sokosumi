import { type Prisma } from "@sokosumi/database";
import { sokoBotDisplayName } from "@/helpers/soko-bot-display-name";
import prisma from "@/lib/db/prisma";
import {
  type AuthorizedSokoBotRuntime,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";
import { ownerDirectReader, ownerDirectWhere } from "./acting-scope";
import { type RuntimeOperations } from "./operations";

/** Everything a project manager needs to act on a Task without opening it. */
/**
 * Rooms the bot itself belongs to. Membership is the whole authorization
 * boundary here: the bot is a Soko Bot in chat, so it sees exactly the
 * rooms a person added it to and nothing else in the workspace.
 */
export async function listChats(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
) {
  const sokoBotId = authorized.turn.sokoBotId;
  const scope = await runtime.chatRoomScope(authorized, sokoBotId);
  const rooms = await prisma.chatRoom.findMany({
    where: scope,
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: {
      id: true,
      name: true,
      groupName: true,
      kind: true,
      updatedAt: true,
      _count: { select: { messages: true } },
    },
  });
  return {
    rooms: rooms.map((room) => ({
      roomId: room.id,
      name: room.groupName ?? room.name,
      kind: room.kind,
      messages: room._count.messages,
      lastActivityAt: room.updatedAt.toISOString(),
    })),
    ...(authorized.askedByKind === "OWNER"
      ? { ownerUnread: await runtime.ownerUnreadRooms(authorized, scope) }
      : {}),
    ...(ownerDirectReader(authorized)
      ? { ownerDirects: await runtime.ownerDirectRooms(authorized, scope) }
      : {}),
  };
}

/** The owner's Directs, newest first; read_chat reads them, nothing writes. */
export async function ownerDirectRooms(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  scope: Prisma.ChatRoomWhereInput,
) {
  const rooms = await prisma.chatRoom.findMany({
    where: ownerDirectWhere(authorized, scope),
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { id: true, name: true, groupName: true, updatedAt: true },
  });
  return rooms.map((room) => ({
    roomId: room.id,
    name: room.groupName ?? room.name,
    lastActivityAt: room.updatedAt.toISOString(),
  }));
}

/**
 * The owner's unread chats as their sidebar counts them: every room the
 * owner is in within this workspace, the bot's own or not. Names and counts
 * only; reading a room still needs the bot's own membership.
 */
export async function ownerUnreadRooms(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  scope: Prisma.ChatRoomWhereInput,
) {
  const ownerId = authorized.turn.actingUserId;
  // A turn that acts for nobody has no owner whose unread chats to count.
  if (ownerId === null) return [];
  const rooms = await prisma.chatRoom.findMany({
    where: {
      archivedAt: null,
      organizationId: scope.organizationId,
      userMembers: { some: { userId: ownerId } },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: {
      id: true,
      name: true,
      groupName: true,
      kind: true,
      sokoBotMembers: {
        where: { sokoBotId: authorized.turn.sokoBotId },
        take: 1,
        select: { sokoBotId: true },
      },
      userMembers: {
        where: { userId: ownerId },
        take: 1,
        select: { mutedAt: true },
      },
    },
  });
  const { getChatRoomUnreadCounts } = await import(
    "@/routes/v1/chats/rooms/room-unread"
  );
  const unread = await getChatRoomUnreadCounts(
    rooms.map((room) => room.id),
    ownerId,
    prisma,
  );
  return rooms.flatMap((room) => {
    const count = unread.get(room.id)?.total ?? 0;
    if (count === 0) return [];
    return [
      {
        roomId: room.id,
        name: room.groupName ?? room.name,
        kind: room.kind,
        unread: count,
        youAreMember: room.sokoBotMembers.length > 0,
        ...(room.userMembers[0]?.mutedAt ? { muted: true } : {}),
      },
    ];
  });
}

/**
 * Rooms the bot may touch: its own Soko Bot memberships, bounded to the
 * workspace the turn runs in. Membership alone is not enough — a bot could
 * in principle be added to a room in another organization, and a turn must
 * never reach outside its own workspace.
 */
export async function chatRoomScope(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  sokoBotId: string,
  client: Prisma.TransactionClient = prisma,
): Promise<Prisma.ChatRoomWhereInput> {
  const workspace = await client.workspace.findUnique({
    where: { id: authorized.turn.workspaceId },
    select: { organizationId: true },
  });
  return {
    archivedAt: null,
    sokoBotMembers: { some: { sokoBotId: sokoBotId } },
    organizationId: workspace?.organizationId ?? null,
  };
}

/** One of the owner's Directs the bot may read, or null. */
export async function ownerDirectRoom(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  roomId: string,
) {
  if (!ownerDirectReader(authorized)) return null;
  const scope = await runtime.chatRoomScope(
    authorized,
    authorized.turn.sokoBotId,
  );
  const room = await prisma.chatRoom.findFirst({
    where: { ...ownerDirectWhere(authorized, scope), id: roomId },
    select: { id: true, name: true, groupName: true },
  });
  if (!room) return null;
  return {
    id: room.id,
    name: room.groupName ?? room.name,
    sokoBotId: authorized.turn.sokoBotId,
  };
}

/**
 * The single authorization boundary for chat: the bot may only touch rooms
 * it belongs to as a Soko Bot, in its own workspace. Re-checked on every
 * call because the room id comes from the model, so removal takes effect at
 * once.
 */
export async function requireChatMembership(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  roomId: string,
  client: Prisma.TransactionClient = prisma,
): Promise<{
  id: string;
  name: string;
  kind: string;
  sokoBotId: string;
  organizationId: string | null;
  authorName: string;
}> {
  const sokoBotId = authorized.turn.sokoBotId;
  const room = await client.chatRoom.findFirst({
    where: {
      ...(await runtime.chatRoomScope(authorized, sokoBotId, client)),
      id: roomId,
    },
    select: {
      id: true,
      name: true,
      groupName: true,
      kind: true,
      organizationId: true,
      sokoBotMembers: {
        where: { sokoBotId: sokoBotId },
        take: 1,
        select: {
          sokoBot: {
            select: { name: true, user: { select: { name: true } } },
          },
        },
      },
    },
  });
  if (!room) {
    throw new SokoBotRuntimeValidationError(
      "You are not a member of that chat room",
    );
  }
  const bot = room.sokoBotMembers?.[0]?.sokoBot;
  return {
    id: room.id,
    name: room.groupName ?? room.name,
    kind: room.kind,
    sokoBotId,
    organizationId: room.organizationId ?? null,
    authorName: bot
      ? sokoBotDisplayName(bot)
      : sokoBotDisplayName({ name: null }),
  };
}

/** Recent messages in one room the bot belongs to, newest first. */
export async function readChat(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  input: { roomId: string; limit?: number; before?: string },
) {
  const room =
    (await runtime.ownerDirectRoom(authorized, input.roomId)) ??
    (await runtime.requireChatMembership(authorized, input.roomId));
  const messages = await prisma.chatRoomMessage.findMany({
    where: {
      roomId: room.id,
      deletedAt: null,
      ...(input.before ? { createdAt: { lt: new Date(input.before) } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: input.limit ?? 30,
    select: {
      id: true,
      content: true,
      createdAt: true,
      senderUser: { select: { name: true } },
      senderCoworker: { select: { id: true, name: true } },
      senderSokoBot: { select: { id: true, name: true } },
    },
  });
  return {
    roomId: room.id,
    name: room.name,
    messages: messages.map((message) => ({
      id: message.id,
      at: message.createdAt.toISOString(),
      from:
        message.senderUser?.name ??
        message.senderCoworker?.name ??
        (message.senderSokoBot
          ? sokoBotDisplayName({ name: message.senderSokoBot.name })
          : "unknown"),
      /** True when the bot itself wrote it. */
      fromYou: message.senderSokoBot?.id === room.sokoBotId,
      // Chat is untrusted text: the operating contract already tells the bot
      // never to follow instructions found in content it reads.
      content: message.content.slice(0, 4_000),
    })),
  };
}
