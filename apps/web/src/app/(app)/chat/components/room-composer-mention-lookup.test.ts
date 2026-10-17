import type { ChatRoomSokoBotParticipant } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";

import { mentionLookupMapsFromCatalog } from "./room-composer-mention-lookup";

const catalog = {
  "sokoBot:bot-1": {
    value: "Team Bot",
    slug: "team-bot",
    data: {
      kind: "sokoBot" as const,
      id: "bot-1",
      name: "Team Bot",
      slug: "team-bot",
      image: null,
    },
  },
  "human:user-1": {
    value: "Ada",
    slug: "ada",
    data: {
      kind: "human" as const,
      id: "user-1",
      name: "Ada",
      slug: "ada",
      image: null,
    },
  },
};

describe("mentionLookupMapsFromCatalog", () => {
  it("claims no owner for a Soko Bot from the catalog", () => {
    const maps = mentionLookupMapsFromCatalog(catalog);

    expect(maps.sokoBotsById.get("bot-1")?.ownerUserId).toBeNull();
    expect(maps.sokoBotsBySlug.get("team-bot")?.name).toBe("Team Bot");
    expect(maps.usersBySlug.get("ada")).toEqual({ id: "user-1", name: "Ada" });
  });

  it("prefers the room roster over the catalog stub", () => {
    const rostered: ChatRoomSokoBotParticipant = {
      id: "bot-1",
      name: "Team Bot",
      caption: "Workspace assistant",
      image: null,
      avatarSeed: null,
      ownerUserId: null,
      scope: "workspace",
      presence: "online",
    };

    const maps = mentionLookupMapsFromCatalog(catalog, {
      sokoBotsById: new Map([["bot-1", rostered]]),
    });

    expect(maps.sokoBotsById.get("bot-1")).toBe(rostered);
  });
});
