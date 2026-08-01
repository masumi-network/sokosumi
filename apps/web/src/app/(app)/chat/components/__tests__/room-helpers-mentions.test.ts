import { describe, expect, it } from "vitest";

import type {
  ChatRoomCoworkerParticipant,
  ChatRoomUserParticipant,
} from "@/lib/clients/generated/core";
import {
  buildRoomAllMentionRecord,
  formatRoomMarkdownMentions,
  ROOM_MENTION_ALL_ID,
  ROOM_MENTION_ALL_SLUG,
  ROOM_MENTION_ALL_TOKEN,
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

describe("formatRoomMarkdownMentions", () => {
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

  it("falls back to the raw id when the member is unknown", () => {
    const formatted = formatRoomMarkdownMentions({
      content: "@missing:ghost hey",
      coworkersById: new Map(),
      coworkersBySlug: new Map(),
      usersById: new Map(),
      usersBySlug: new Map(),
    });

    expect(formatted).toContain("@missing");
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
  });
});

describe("buildRoomAllMentionRecord", () => {
  it("builds a synthetic catalog entry keyed as all", () => {
    const record = buildRoomAllMentionRecord();
    expect(record.slug).toBe(ROOM_MENTION_ALL_SLUG);
    expect(record.data).toEqual({
      kind: "all",
      id: ROOM_MENTION_ALL_ID,
      name: ROOM_MENTION_ALL_ID,
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
