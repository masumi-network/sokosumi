import { describe, expect, it } from "vitest";

import { mergeCoworkerMetadata, normalizeCoworkerMetadata } from "./metadata";

describe("mergeCoworkerMetadata", () => {
  it("preserves profile and offers when PATCH only updates channels", () => {
    const result = mergeCoworkerMetadata(
      {
        channels: {
          email: "old@example.com",
        },
        profile: {
          llm: ["GPT-4o"],
        },
        offers: [
          {
            title: "Competitive analysis",
            prompt: "Analyze competitors.",
          },
        ],
      },
      {
        channels: {
          whatsapp: "+49151xxxx",
        },
      },
    );

    expect(result).toEqual({
      channels: {
        email: "old@example.com",
        whatsapp: "+49151xxxx",
      },
      profile: {
        llm: ["GPT-4o"],
      },
      offers: [
        {
          title: "Competitive analysis",
          prompt: "Analyze competitors.",
        },
      ],
    });
  });

  it("replaces profile and offers when PATCH includes them", () => {
    const result = mergeCoworkerMetadata(
      {
        channels: {
          email: "old@example.com",
        },
        profile: {
          llm: ["GPT-4o"],
        },
        offers: [
          {
            title: "Old offer",
            prompt: "Old prompt.",
          },
        ],
      },
      {
        channels: {
          email: "new@example.com",
        },
        profile: {
          hosting: "EU · Frankfurt",
        },
        offers: [],
      },
    );

    expect(result).toEqual({
      channels: {
        email: "new@example.com",
      },
      profile: {
        hosting: "EU · Frankfurt",
      },
      offers: [],
    });
  });
});

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
