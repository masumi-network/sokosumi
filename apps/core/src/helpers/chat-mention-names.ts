import type { Prisma } from "@sokosumi/database";
import { CHAT_MENTION_ALL_KEY, readChatMentionKeys } from "@sokosumi/utils";

import prisma from "@/lib/db/prisma";

type MentionNameClient = Pick<
  Prisma.TransactionClient,
  "chatRoomUserMember" | "chatRoomCoworkerMember" | "chatRoomSokoBotMember"
>;

/**
 * The display names the room shows for the members a message mentions.
 *
 * A mention is written as `@<member id>:<slug>`, where the slug is the name
 * rewritten to lowercase ascii words. Read back on its own it is a second
 * spelling of a name (`@ada-lovelace` for `Ada Lovelace`) and, for a name the
 * rewrite keeps nothing of, no spelling at all. So the name is read from the
 * member rather than from the token.
 *
 * Only the mentioned members are read, not the room's roster: a channel can
 * hold hundreds of people and a message names a handful of them.
 *
 * A key that names nobody in the room is simply absent from the map. That
 * covers the room-wide `@all`, a member who has since left, and a token
 * carrying an id from another room, and the caller keeps the slug for each.
 *
 * The three reads run one after another rather than together, because this
 * also runs inside an interactive transaction, where Prisma allows one query
 * at a time on the client it hands out.
 */
export async function loadChatMentionNames(params: {
  roomId: string;
  content: string;
  client?: MentionNameClient;
}): Promise<ReadonlyMap<string, string>> {
  const keys = readChatMentionKeys(params.content).filter(
    (key) => key !== CHAT_MENTION_ALL_KEY,
  );
  const names = new Map<string, string>();

  if (keys.length === 0) {
    return names;
  }

  const client = params.client ?? prisma;

  const userMembers = await client.chatRoomUserMember.findMany({
    where: { roomId: params.roomId, userId: { in: keys } },
    select: { user: { select: { id: true, name: true } } },
  });
  for (const member of userMembers) {
    if (member.user.name) {
      names.set(member.user.id, member.user.name);
    }
  }

  const coworkerMembers = await client.chatRoomCoworkerMember.findMany({
    where: { roomId: params.roomId, coworkerId: { in: keys } },
    select: { coworker: { select: { id: true, name: true } } },
  });
  for (const member of coworkerMembers) {
    if (member.coworker.name) {
      names.set(member.coworker.id, member.coworker.name);
    }
  }

  const sokoBotMembers = await client.chatRoomSokoBotMember.findMany({
    where: { roomId: params.roomId, sokoBotId: { in: keys } },
    select: { sokoBot: { select: { id: true, name: true } } },
  });
  for (const member of sokoBotMembers) {
    if (member.sokoBot.name) {
      names.set(member.sokoBot.id, member.sokoBot.name);
    }
  }

  return names;
}
