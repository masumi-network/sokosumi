import { isRetiredSharedSokoBotRoom } from "@/helpers/shared-soko-bot-room";

export const DIRECT_PARTICIPANT_KEY_PREFIX = "direct:v2:";

/**
 * Humans a Direct was started for, read from its participant key. Empty for
 * Self Directs and AI 1:1s, whose one human owns the room and is never left
 * out of it while it exists. SQL `chat_direct_key_user_ids` mirrors this for
 * the Organization rejoin trigger; change both together.
 */
function directKeyUserIds(directKey: string): string[] {
  if (directKey.startsWith(DIRECT_PARTICIPANT_KEY_PREFIX)) {
    const parts = directKey
      .slice(DIRECT_PARTICIPANT_KEY_PREFIX.length)
      .split(":");
    return parts.filter(
      (_part, index) => index % 2 === 1 && parts[index - 1] === "user",
    );
  }
  // A human 1:1 key is the two user ids; every other key is namespaced.
  const parts = directKey.split(":");
  return parts.length === 2 ? parts : [];
}

/**
 * Former members of a Direct: the humans it was started for who are no longer
 * in it. Organization exit takes a member out of an Org Direct but keeps its
 * participant key, so the key still says who the Direct was with.
 */
export function formerDirectUserIds(room: {
  kind: string;
  directKey: string | null;
  userMembers: ReadonlyArray<{ userId: string }>;
}): string[] {
  if (room.kind !== "direct" || !room.directKey) {
    return [];
  }
  const memberIds = new Set(room.userMembers.map((member) => member.userId));
  return directKeyUserIds(room.directKey).filter(
    (userId) => !memberIds.has(userId),
  );
}

/**
 * A Direct whose every other participant has left: nobody would read what is
 * added, so it keeps its history but takes no new messages, uploads or
 * Reactions (see `requireWritableChatRoom`).
 */
export function isReadOnlyDirectRoom(room: {
  kind: string;
  directKey: string | null;
  userMembers: ReadonlyArray<{ userId: string }>;
  coworkerMembers: readonly unknown[];
  sokoBotMembers: readonly unknown[];
}): boolean {
  return (
    room.userMembers.length <= 1 &&
    room.coworkerMembers.length === 0 &&
    room.sokoBotMembers.length === 0 &&
    formerDirectUserIds(room).length > 0
  );
}

/**
 * Whether a room takes nothing new: a Read-only Direct, or the room of an
 * archived or deleted shared Soko Bot. `requireWritableChatRoom` enforces it.
 */
export function isReadOnlyChatRoom(
  room: Parameters<typeof isReadOnlyDirectRoom>[0] &
    Parameters<typeof isRetiredSharedSokoBotRoom>[0],
): boolean {
  return isReadOnlyDirectRoom(room) || isRetiredSharedSokoBotRoom(room);
}
