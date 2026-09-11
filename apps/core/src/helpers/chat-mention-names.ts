import type { Prisma } from "@sokosumi/database";
import { CHAT_MENTION_ALL_KEY, readChatMentionKeys } from "@sokosumi/utils";

import prisma from "@/lib/db/prisma";

type MentionNameClient = Pick<
  Prisma.TransactionClient,
  "chatRoomUserMember" | "chatRoomCoworkerMember" | "chatRoomSokoBotMember"
>;

/**
 * What the `uuid` column accepts, which is what may be compared against it.
 *
 * `sokoBotId` is `uuid`, and a human mention key can be a legacy 32-character
 * auth id. Postgres rejects that comparison outright rather than matching
 * nothing, and the throw reaches the notification fan-out before it has
 * written anybody a row, so one such key costs every recipient of the message
 * their notification.
 *
 * Deliberately wider than a schema validator: hyphens are optional and the
 * version and variant nibbles are any hex, so every shape `readChatMentionKeys`
 * emits that the column would have matched still reaches it. A key that is hex
 * in this shape and names no bot simply comes back empty, which is the answer
 * it had before.
 *
 * Not every spelling Postgres itself parses. It also takes a hyphen after any
 * group of four digits, and a brace-wrapped uuid, neither of which the mention
 * token regex can produce. Widen this alongside that regex rather than ahead
 * of it: a shape nothing writes is a shape nothing here can be tested against.
 */
const UUID_TEXT_REGEX =
  /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

/**
 * The display names the room shows for the members a message mentions.
 *
 * Human mentions use `@<member id>`. Existing human mentions and current
 * agent mentions may include `:<slug>`. Resolve display names from room
 * members by ID so previews reflect the current name.
 *
 * Only the mentioned members are read, not the room's roster: a channel can
 * hold hundreds of people and a message names a handful of them.
 *
 * A key that names nobody in the room is simply absent from the map. That
 * covers the room-wide `@all`, a member who has since left, and a token
 * carrying an id from another room. The preview uses a readable legacy slug
 * when available, otherwise its unnamed-mention fallback.
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

  const sokoBotKeys = keys.filter((key) => UUID_TEXT_REGEX.test(key));
  const sokoBotMembers =
    sokoBotKeys.length === 0
      ? []
      : await client.chatRoomSokoBotMember.findMany({
          where: { roomId: params.roomId, sokoBotId: { in: sokoBotKeys } },
          select: { sokoBot: { select: { id: true, name: true } } },
        });
  for (const member of sokoBotMembers) {
    if (member.sokoBot.name) {
      names.set(member.sokoBot.id, member.sokoBot.name);
    }
  }

  return names;
}
