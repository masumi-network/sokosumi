import { describe, expect, it } from "vitest";

import {
  channelNameFromSlug,
  liveSanitizeChannelSlug,
  sanitizeChannelSlug,
} from "../channel-slug.js";

describe("liveSanitizeChannelSlug", () => {
  it("turns spaces into hyphens and keeps a trailing hyphen while typing", () => {
    expect(liveSanitizeChannelSlug("team ")).toBe("team-");
    expect(liveSanitizeChannelSlug("team soko")).toBe("team-soko");
  });

  it("keeps a hyphen the user typed", () => {
    expect(liveSanitizeChannelSlug("team-")).toBe("team-");
    expect(liveSanitizeChannelSlug("team-soko")).toBe("team-soko");
  });

  it("collapses runs of spaces or hyphens to one hyphen", () => {
    expect(liveSanitizeChannelSlug("team--soko")).toBe("team-soko");
    expect(liveSanitizeChannelSlug("team  soko")).toBe("team-soko");
  });

  it("strips leading hyphens but not trailing ones", () => {
    expect(liveSanitizeChannelSlug("-team")).toBe("team");
    expect(liveSanitizeChannelSlug(" team")).toBe("team");
  });
});

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
