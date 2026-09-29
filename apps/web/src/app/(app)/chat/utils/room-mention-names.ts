import { CHAT_MENTION_ALL_KEY } from "@sokosumi/utils";

/** A member a mention token can name, by the id the token carries. */
interface NamedMember {
  id: string;
  name?: string | null;
}

/** As much of a room as naming its members needs. */
export interface RoomMentionRoster {
  userMembers?: ReadonlyArray<NamedMember & { email?: string | null }>;
  coworkerMembers?: ReadonlyArray<NamedMember>;
  sokoBotMembers?: ReadonlyArray<NamedMember>;
}

/**
 * Who a mention token in this room's messages names, by the id it carries.
 *
 * One builder for the thread list and the sidebar's inset thread rows: both
 * label a Thread by its parent message, and a parent that reads one way in
 * the list and another way in the sidebar is two answers to one message.
 * `allLabel` is what the room-wide mention reads as.
 */
export function roomMentionNames(
  room: RoomMentionRoster | null | undefined,
  allLabel: string,
): Map<string, string> {
  return new Map<string, string>([
    [CHAT_MENTION_ALL_KEY, allLabel],
    ...(room?.userMembers ?? []).map(
      (user) => [user.id, user.name || user.email || ""] as const,
    ),
    ...(room?.coworkerMembers ?? []).map(
      (coworker) => [coworker.id, coworker.name ?? ""] as const,
    ),
    ...(room?.sokoBotMembers ?? []).map(
      (sokoBot) => [sokoBot.id, sokoBot.name ?? ""] as const,
    ),
  ]);
}
