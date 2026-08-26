import { describe, expect, it } from "vitest";

import { channelNameFromSlug, sanitizeChannelSlug } from "../channel-slug.js";

describe("channelNameFromSlug", () => {
  it("title-cases kebab segments and joins with spaces", () => {
    expect(channelNameFromSlug("team-soko")).toBe("Team Soko");
    expect(channelNameFromSlug("welcome")).toBe("Welcome");
    expect(channelNameFromSlug("q1-okrs")).toBe("Q1 Okrs");
  });

  it("returns empty when the slug is empty", () => {
    expect(channelNameFromSlug("")).toBe("");
  });

  it("uses the sanitized handle, not a display name", () => {
    expect(channelNameFromSlug(sanitizeChannelSlug(" Team Soko "))).toBe(
      "Team Soko",
    );
  });
});
