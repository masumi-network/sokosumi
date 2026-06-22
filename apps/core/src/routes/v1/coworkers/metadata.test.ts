import { describe, expect, it } from "vitest";

import { normalizeCoworkerMetadata } from "./metadata";

describe("normalizeCoworkerMetadata", () => {
  it("preserves profile and offers alongside normalized channels", () => {
    const result = normalizeCoworkerMetadata({
      channels: {
        email: "ops@example.com",
      },
      profile: {
        llm: ["GPT-4o"],
        hosting: "EU · Frankfurt",
      },
      offers: [
        {
          title: "Competitive analysis",
          prompt: "Analyze my top competitors.",
        },
      ],
    });

    expect(result).toEqual({
      channels: {
        email: "ops@example.com",
      },
      profile: {
        llm: ["GPT-4o"],
        hosting: "EU · Frankfurt",
      },
      offers: [
        {
          title: "Competitive analysis",
          prompt: "Analyze my top competitors.",
        },
      ],
    });
  });

  it("keeps profile and offers when channels normalize to empty", () => {
    const result = normalizeCoworkerMetadata({
      channels: {
        " ": " ",
      },
      profile: {
        capabilities: ["Research"],
      },
      offers: [],
    });

    expect(result).toEqual({
      channels: {},
      profile: {
        capabilities: ["Research"],
      },
      offers: [],
    });
  });

  it("returns null when metadata has no persisted content", () => {
    expect(
      normalizeCoworkerMetadata({
        channels: {
          " ": "",
        },
      }),
    ).toBeNull();
  });
});
