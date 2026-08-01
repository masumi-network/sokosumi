import { describe, expect, it } from "vitest";

import type {
  ChatRoomCoworkerParticipant,
  ChatRoomUserParticipant,
} from "@/lib/clients/generated/core";
import { formatRoomMarkdownMentions } from "../room-helpers";

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

    expect(formatted).toContain(
      '<span class="text-primary font-medium">@Elena</span>',
    );
    expect(formatted).toContain("and @nobody please");
    expect(formatted.match(/text-primary/g)).toHaveLength(1);
  });
});
