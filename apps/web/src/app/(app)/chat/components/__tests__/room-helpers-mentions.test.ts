import { describe, expect, it } from "vitest";

import type { NormalizedMention } from "@/components/ui/mention-textarea-utils";
import type {
  ChatRoomCoworkerParticipant,
  ChatRoomUserParticipant,
} from "@/lib/clients/generated/core";
import {
  buildRoomAllMentionRecord,
  formatRoomMarkdownContent,
  formatRoomMarkdownMentions,
  membershipVisibleChannelLinks,
  membershipVisibleChannelOptions,
  mergeMembershipVisibleRooms,
  parseMentionDirectChip,
  partitionRoomMentionSuggestions,
  ROOM_MENTION_ALL_ID,
  ROOM_MENTION_ALL_SLUG,
  ROOM_MENTION_ALL_TOKEN,
  type RoomMentionParticipant,
  shouldIncludeRoomAllMention,
} from "../room-helpers";

const coworker: ChatRoomCoworkerParticipant = {
  id: "cow_1",
  name: "Elena",
  slug: "elena",
  caption: null,
  image: null,
  presence: "online",
};

const human: ChatRoomUserParticipant = {
  id: "user_1",
  name: "Alice Smith",
  email: "alice@example.com",
  image: null,
  presence: "online",
};

const LABELS = { peopleLabel: "People", coworkersLabel: "Coworkers" };

function mention(
  partial: Omit<NormalizedMention<RoomMentionParticipant>, "slug"> & {
    slug?: string;
  },
): NormalizedMention<RoomMentionParticipant> {
  return {
    slug: partial.slug ?? partial.key,
    ...partial,
  };
}

function hoverChip(kind: "human" | "coworker", id: string, label: string) {
  return `<span class="text-primary font-medium" data-direct-kind="${kind}" data-direct-id="${id}">@${label}</span>`;
}

describe("formatRoomMarkdownMentions", () => {
  it("identifies a resolved coworker chip for hover", () => {
    const formatted = formatRoomMarkdownMentions({
      content: `@${coworker.id}:${coworker.slug} please look`,
      coworkersById: new Map([[coworker.id, coworker]]),
      coworkersBySlug: new Map([[coworker.slug, coworker]]),
      usersById: new Map(),
      usersBySlug: new Map(),
    });

    expect(formatted).toBe(
      `${hoverChip("coworker", coworker.id, "Elena")} please look`,
    );
  });

  it("identifies a resolved human chip for hover", () => {
    const formatted = formatRoomMarkdownMentions({
      content: `@${human.id}:alice-smith please look`,
      coworkersById: new Map(),
      coworkersBySlug: new Map(),
      usersById: new Map([[human.id, human]]),
      usersBySlug: new Map([["alice-smith", human]]),
    });

    expect(formatted).toBe(
      `${hoverChip("human", human.id, "Alice Smith")} please look`,
    );
  });

  it("still identifies a coworker chip when the human roster is empty", () => {
    const formatted = formatRoomMarkdownMentions({
      content: `@${coworker.id}:${coworker.slug}`,
      coworkersById: new Map([[coworker.id, coworker]]),
      coworkersBySlug: new Map([[coworker.slug, coworker]]),
      usersById: new Map(),
      usersBySlug: new Map(),
    });

    expect(formatted).toBe(hoverChip("coworker", coworker.id, "Elena"));
  });

  it("renders coworker and human mention chips from tokens", () => {
    const content = `@${coworker.id}:${coworker.slug} please ping @${human.id}:alice-smith`;
    const formatted = formatRoomMarkdownMentions({
      content,
      coworkersById: new Map([[coworker.id, coworker]]),
      coworkersBySlug: new Map([[coworker.slug, coworker]]),
      usersById: new Map([[human.id, human]]),
      usersBySlug: new Map([["alice-smith", human]]),
    });

    expect(formatted).toContain("@Elena");
    expect(formatted).toContain("@Alice Smith");
    expect(formatted).toContain('class="text-primary font-medium"');
  });

  it("leaves unknown mention tokens unstyled", () => {
    const formatted = formatRoomMarkdownMentions({
      content: "@missing:ghost hey",
      coworkersById: new Map(),
      coworkersBySlug: new Map(),
      usersById: new Map(),
      usersBySlug: new Map(),
    });

    expect(formatted).toBe("@missing:ghost hey");
    expect(formatted).not.toContain("text-primary");
  });

  it("leaves a departed roster mention unstyled", () => {
    const formatted = formatRoomMarkdownMentions({
      content: `@${human.id}:alice-smith please look`,
      coworkersById: new Map(),
      coworkersBySlug: new Map(),
      usersById: new Map(),
      usersBySlug: new Map(),
    });

    expect(formatted).toBe(`@${human.id}:alice-smith please look`);
    expect(formatted).not.toContain("data-direct-kind");
    expect(formatted).not.toContain("text-primary");
  });

  it("does not highlight bare @words or email local-parts", () => {
    const formatted = formatRoomMarkdownMentions({
      content: "ping @nobody and alice@example.com",
      coworkersById: new Map(),
      coworkersBySlug: new Map(),
      usersById: new Map(),
      usersBySlug: new Map(),
    });

    expect(formatted).toBe("ping @nobody and alice@example.com");
    expect(formatted).not.toContain("text-primary");
  });

  it("highlights only resolved mentions when mixed with bare @words", () => {
    const content = `@${coworker.id}:${coworker.slug} and @nobody please`;
    const formatted = formatRoomMarkdownMentions({
      content,
      coworkersById: new Map([[coworker.id, coworker]]),
      coworkersBySlug: new Map([[coworker.slug, coworker]]),
      usersById: new Map(),
      usersBySlug: new Map(),
    });

    expect(formatted).toContain(hoverChip("coworker", coworker.id, "Elena"));
    expect(formatted).toContain("and @nobody please");
    expect(formatted.match(/text-primary/g)).toHaveLength(1);
  });

  it("renders @all:all as an @all chip without member lookup", () => {
    const formatted = formatRoomMarkdownMentions({
      content: `${ROOM_MENTION_ALL_TOKEN} please look`,
      coworkersById: new Map(),
      coworkersBySlug: new Map(),
      usersById: new Map(),
      usersBySlug: new Map(),
    });

    expect(formatted).toContain(">@all</span>");
    expect(formatted).not.toContain("@all:all");
    expect(formatted).not.toContain("data-direct-kind");
  });

  it("renders bare @all as an @all chip", () => {
    const formatted = formatRoomMarkdownMentions({
      content: "@all please look",
      coworkersById: new Map(),
      coworkersBySlug: new Map(),
      usersById: new Map(),
      usersBySlug: new Map(),
    });

    expect(formatted).toContain(">@all</span>");
  });
});

describe("parseMentionDirectChip", () => {
  it("reads kind and id from a formatted Direct chip", () => {
    const formatted = formatRoomMarkdownMentions({
      content: `@${coworker.id}:${coworker.slug}`,
      coworkersById: new Map([[coworker.id, coworker]]),
      coworkersBySlug: new Map([[coworker.slug, coworker]]),
      usersById: new Map(),
      usersBySlug: new Map(),
    });
    const root = document.createElement("div");
    root.innerHTML = formatted;
    const chip = root.querySelector("[data-direct-kind]");
    expect(chip).not.toBeNull();
    expect(parseMentionDirectChip(chip as Element)).toEqual({
      kind: "coworker",
      id: coworker.id,
    });
  });

  it("rejects inert mention chips and Channel links", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<span class="text-primary font-medium">@all</span> <a href="/chat/rooms/room-1">#general</a>';
    const allChip = root.querySelector("span");
    const channelLink = root.querySelector("a");
    expect(allChip).not.toBeNull();
    expect(channelLink).not.toBeNull();
    expect(parseMentionDirectChip(allChip as Element)).toBeNull();
    expect(parseMentionDirectChip(channelLink as Element)).toBeNull();
  });
});

describe("formatRoomMarkdownContent", () => {
  it("linkifies membership-visible channels after mention chips", () => {
    const formatted = formatRoomMarkdownContent({
      content: `@${coworker.id}:${coworker.slug} see #general`,
      coworkersById: new Map([[coworker.id, coworker]]),
      coworkersBySlug: new Map([[coworker.slug, coworker]]),
      usersById: new Map(),
      usersBySlug: new Map(),
      channelLinks: [
        {
          name: "general",
          slug: "general",
          href: "/chat/rooms/room-general",
        },
      ],
    });

    expect(formatted).toContain(hoverChip("coworker", coworker.id, "Elena"));
    expect(formatted).toContain("[#general](/chat/rooms/room-general)");
  });
});

describe("membershipVisibleChannelLinks", () => {
  it("keeps Channels and drops Directs", () => {
    expect(
      membershipVisibleChannelLinks([
        {
          id: "c1",
          name: "general",
          slug: "general",
          kind: "channel",
        },
        {
          id: "d1",
          name: "Alice",
          slug: null,
          kind: "direct",
        },
      ]),
    ).toEqual([
      {
        name: "general",
        slug: "general",
        href: "/chat/rooms/c1",
      },
    ]);
  });
});

describe("membershipVisibleChannelOptions", () => {
  it("omits org name for ordinary host Channels", () => {
    expect(
      membershipVisibleChannelOptions([
        {
          id: "c1",
          name: "Launch Room",
          slug: "launch-room",
          kind: "channel",
          organizationName: "Acme",
          discoverability: "public",
          myAccess: "member",
        },
      ]),
    ).toEqual([
      {
        id: "c1",
        name: "Launch Room",
        slug: "launch-room",
        organizationName: null,
      },
    ]);
  });

  it("shows org name for External Channels", () => {
    expect(
      membershipVisibleChannelOptions([
        {
          id: "c2",
          name: "Client",
          slug: "client",
          kind: "channel",
          organizationName: "Acme",
          discoverability: "external",
          myAccess: "member",
        },
      ]),
    ).toEqual([
      {
        id: "c2",
        name: "Client",
        slug: "client",
        organizationName: "Acme",
      },
    ]);
  });

  it("shows org name for guest access on a host Channel", () => {
    expect(
      membershipVisibleChannelOptions([
        {
          id: "c3",
          name: "Standup",
          slug: "standup",
          kind: "channel",
          organizationName: "Acme",
          discoverability: "public",
          myAccess: "guest",
        },
      ]),
    ).toEqual([
      {
        id: "c3",
        name: "Standup",
        slug: "standup",
        organizationName: "Acme",
      },
    ]);
  });
});

describe("mergeMembershipVisibleRooms", () => {
  it("keeps sidebar rooms and adds a page room the sidebar does not have yet", () => {
    expect(
      mergeMembershipVisibleRooms(
        [{ id: "new" }, { id: "c1" }],
        [{ id: "c1" }, { id: "c2" }],
      ),
    ).toEqual([{ id: "c1" }, { id: "c2" }, { id: "new" }]);
  });
});

describe("buildRoomAllMentionRecord", () => {
  it("builds a synthetic catalog entry keyed as all with localized label", () => {
    const record = buildRoomAllMentionRecord("Everyone");
    expect(record.value).toBe("Everyone");
    expect(record.slug).toBe(ROOM_MENTION_ALL_SLUG);
    expect(record.data).toEqual({
      kind: "all",
      id: ROOM_MENTION_ALL_ID,
      name: "Everyone",
      slug: ROOM_MENTION_ALL_SLUG,
      image: null,
    });
  });
});

describe("shouldIncludeRoomAllMention", () => {
  it("includes @all for channels with another human", () => {
    expect(
      shouldIncludeRoomAllMention(
        {
          kind: "channel",
          userMembers: [{ id: "self" }, { id: "alice" }],
          coworkerMembers: [],
        },
        "self",
      ),
    ).toBe(true);
  });

  it("hides @all when the author is the only human", () => {
    expect(
      shouldIncludeRoomAllMention(
        {
          kind: "channel",
          userMembers: [{ id: "self" }],
          coworkerMembers: [{ id: "cow_1" }],
        },
        "self",
      ),
    ).toBe(false);
  });

  it("hides @all for 1:1 directs even with another human", () => {
    expect(
      shouldIncludeRoomAllMention(
        {
          kind: "direct",
          userMembers: [{ id: "self" }, { id: "alice" }],
          coworkerMembers: [],
        },
        "self",
      ),
    ).toBe(false);
  });

  it("includes @all for group directs with another human", () => {
    expect(
      shouldIncludeRoomAllMention(
        {
          kind: "direct",
          userMembers: [{ id: "self" }, { id: "alice" }, { id: "bob" }],
          coworkerMembers: [],
        },
        "self",
      ),
    ).toBe(true);
  });
});

describe("partitionRoomMentionSuggestions", () => {
  const allMention = mention({
    key: ROOM_MENTION_ALL_ID,
    value: "Everyone",
    slug: ROOM_MENTION_ALL_SLUG,
    data: {
      kind: "all",
      id: ROOM_MENTION_ALL_ID,
      name: "Everyone",
      slug: ROOM_MENTION_ALL_SLUG,
      image: null,
    },
  });

  const humanMention = mention({
    key: human.id,
    value: human.name,
    slug: "alice-smith",
    data: {
      kind: "human",
      id: human.id,
      name: human.name,
      slug: "alice-smith",
      image: null,
    },
  });

  const coworkerMention = mention({
    key: coworker.id,
    value: coworker.name,
    slug: coworker.slug,
    data: {
      kind: "coworker",
      id: coworker.id,
      name: coworker.name,
      slug: coworker.slug,
      image: null,
    },
  });

  it("puts @all and humans in People, coworkers in Coworkers", () => {
    const groups = partitionRoomMentionSuggestions(
      [allMention, humanMention, coworkerMention],
      LABELS,
    );

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ id: "people", label: "People" });
    expect(groups[0]?.items.map((item) => item.key)).toEqual([
      ROOM_MENTION_ALL_ID,
      human.id,
    ]);
    expect(groups[1]).toMatchObject({ id: "coworkers", label: "Coworkers" });
    expect(groups[1]?.items.map((item) => item.key)).toEqual([coworker.id]);
  });

  it("omits empty sections after filter", () => {
    expect(
      partitionRoomMentionSuggestions([humanMention], LABELS).map((g) => g.id),
    ).toEqual(["people"]);
    expect(
      partitionRoomMentionSuggestions([coworkerMention], LABELS).map(
        (g) => g.id,
      ),
    ).toEqual(["coworkers"]);
    expect(partitionRoomMentionSuggestions([], LABELS)).toEqual([]);
  });

  it("keeps People above Coworkers when both non-empty", () => {
    const groups = partitionRoomMentionSuggestions(
      [coworkerMention, humanMention],
      LABELS,
    );
    expect(groups.map((g) => g.id)).toEqual(["people", "coworkers"]);
  });

  it("preserves within-People filter order (@all stays first when present)", () => {
    const bob = mention({
      key: "user_2",
      value: "Bob",
      slug: "bob",
      data: {
        kind: "human",
        id: "user_2",
        name: "Bob",
        slug: "bob",
        image: null,
      },
    });
    const groups = partitionRoomMentionSuggestions(
      [allMention, bob, humanMention, coworkerMention],
      LABELS,
    );
    expect(groups[0]?.items.map((item) => item.key)).toEqual([
      ROOM_MENTION_ALL_ID,
      "user_2",
      human.id,
    ]);
  });

  it("treats mentions without data/kind as People (safe fallback)", () => {
    const unknown = mention({ key: "x", value: "Unknown" });
    const groups = partitionRoomMentionSuggestions([unknown], LABELS);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.id).toBe("people");
    expect(groups[0]?.items).toEqual([unknown]);
  });
});
