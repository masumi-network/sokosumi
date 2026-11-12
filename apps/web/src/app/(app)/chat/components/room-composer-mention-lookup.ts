import {
  type ChatRoomCoworkerParticipant,
  type ChatRoomSokoBotParticipant,
  ChatRoomSokoBotScope,
  type ChatRoomUserParticipant,
} from "@sokosumi/core-client";

import type { MentionRecordEntry } from "@/components/ui/mention-textarea-utils";
import type { RoomMentionParticipant } from "./room-helpers";

export type UserMentionLookup = Pick<ChatRoomUserParticipant, "id" | "name">;

function mergeLookupMap<T>(
  base: Map<string, T>,
  extra?: Map<string, T>,
): Map<string, T> {
  if (!extra || extra.size === 0) {
    return base;
  }
  const merged = new Map(base);
  for (const [key, value] of extra) {
    merged.set(key, value);
  }
  return merged;
}

export function mentionLookupMapsFromCatalog(
  mentions: Record<string, MentionRecordEntry<RoomMentionParticipant>>,
  roster?: {
    coworkersById?: Map<string, ChatRoomCoworkerParticipant>;
    coworkersBySlug?: Map<string, ChatRoomCoworkerParticipant>;
    sokoBotsById?: Map<string, ChatRoomSokoBotParticipant>;
    sokoBotsBySlug?: Map<string, ChatRoomSokoBotParticipant>;
    usersById?: Map<string, UserMentionLookup>;
    usersBySlug?: Map<string, UserMentionLookup>;
  },
): {
  coworkersById: Map<string, ChatRoomCoworkerParticipant>;
  coworkersBySlug: Map<string, ChatRoomCoworkerParticipant>;
  sokoBotsById: Map<string, ChatRoomSokoBotParticipant>;
  sokoBotsBySlug: Map<string, ChatRoomSokoBotParticipant>;
  usersById: Map<string, UserMentionLookup>;
  usersBySlug: Map<string, UserMentionLookup>;
} {
  const coworkersById = new Map<string, ChatRoomCoworkerParticipant>();
  const coworkersBySlug = new Map<string, ChatRoomCoworkerParticipant>();
  const sokoBotsById = new Map<string, ChatRoomSokoBotParticipant>();
  const sokoBotsBySlug = new Map<string, ChatRoomSokoBotParticipant>();
  const usersById = new Map<string, UserMentionLookup>();
  const usersBySlug = new Map<string, UserMentionLookup>();

  for (const entry of Object.values(mentions)) {
    const data = entry.data;
    if (!data) {
      continue;
    }
    if (data.kind === "coworker") {
      const coworker: ChatRoomCoworkerParticipant = {
        id: data.id,
        name: data.name,
        slug: data.slug,
        caption: null,
        image: data.image,
        presence: "offline",
      };
      coworkersById.set(data.id, coworker);
      coworkersBySlug.set(data.slug, coworker);
      continue;
    }
    if (data.kind === "sokoBot") {
      const sokoBot: ChatRoomSokoBotParticipant = {
        id: data.id,
        name: data.name,
        caption: null,
        image: data.image,
        avatarSeed: null,
        // Owner and scope are not on the mention catalog, and nothing reading
        // this lookup asks; null claims no owner for a bot that may be shared.
        ownerUserId: null,
        scope: ChatRoomSokoBotScope.PERSONAL,
        sharedRoomId: null,
        presence: "offline",
      };
      sokoBotsById.set(data.id, sokoBot);
      sokoBotsBySlug.set(data.slug, sokoBot);
      continue;
    }
    if (data.kind === "human") {
      const user: UserMentionLookup = { id: data.id, name: data.name };
      usersById.set(data.id, user);
      usersBySlug.set(data.slug, user);
    }
  }

  return {
    coworkersById: mergeLookupMap(coworkersById, roster?.coworkersById),
    coworkersBySlug: mergeLookupMap(coworkersBySlug, roster?.coworkersBySlug),
    sokoBotsById: mergeLookupMap(sokoBotsById, roster?.sokoBotsById),
    sokoBotsBySlug: mergeLookupMap(sokoBotsBySlug, roster?.sokoBotsBySlug),
    usersById: mergeLookupMap(usersById, roster?.usersById),
    usersBySlug: mergeLookupMap(usersBySlug, roster?.usersBySlug),
  };
}
