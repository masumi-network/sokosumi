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
});
