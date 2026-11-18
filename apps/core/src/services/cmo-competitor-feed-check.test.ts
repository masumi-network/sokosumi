import type { SaveCompetitorFeedInput } from "@sokosumi/soko-bot";
import { describe, expect, it } from "vitest";

import { cusoFeedProblems } from "./cmo-competitor-feed-check";

const CROSSMINT = "11111111-1111-4111-8111-111111111111";
const ENJIN = "22222222-2222-4222-8222-222222222222";
const NAMES = new Map([
  [CROSSMINT, "Crossmint"],
  [ENJIN, "Enjin"],
]);
const SIGNAL = "33333333-3333-4333-8333-333333333333";

function feed(
  ...items: { competitorId: string; meaning: string; move: string }[]
): SaveCompetitorFeedInput {
  return {
    items: items.map((item) => ({
      ...item,
      facts: [
        { text: "It did something.", signalIds: [SIGNAL], support: "strong" },
      ],
    })),
    openQuestions: [],
  };
}

describe("cusoFeedProblems", () => {
  // NMKR's feed of 18 Nov 2026, with only X connected.
  it("refuses a meaning that fits any move and a post on a network that is not connected", () => {
    const problems = cusoFeedProblems(
      feed({
        competitorId: CROSSMINT,
        meaning:
          "The strategy’s product-led posts can give developers concrete workflow context.",
        move: "Post on LinkedIn Nov 20: explain one NMKR API use case for developers.",
      }),
      NAMES,
      new Set(["x"]),
    );

    expect(problems).toEqual([
      expect.stringContaining("would fit any move"),
      'The move for Crossmint uses LinkedIn, which is not connected. Use X, or write it as "Connect LinkedIn, then …".',
    ]);
  });

  it("keeps a meaning about that competitor's move and a move on a connected network", () => {
    const problems = cusoFeedProblems(
      feed(
        {
          competitorId: CROSSMINT,
          meaning:
            "Crossmint's Menta plugin targets agent builders, a group NMKR's API pages do not speak to yet.",
          move: "Post on X Nov 20: show one NMKR API call an agent can make.",
        },
        {
          competitorId: ENJIN,
          meaning:
            "Enjin's Governance 2.0 is on its own chain, so it does not touch NMKR's Cardano creators.",
          move: "Connect LinkedIn, then post one NMKR Studio workflow for token projects there.",
        },
      ),
      NAMES,
      new Set(["x"]),
    );

    expect(problems).toEqual([]);
  });

  it("refuses two items that say the same under meaning", () => {
    const meaning =
      "Enjin's upgrade is on its own chain, so NMKR's Cardano creators are not affected.";
    const problems = cusoFeedProblems(
      feed(
        { competitorId: ENJIN, meaning, move: "Post on X Nov 21." },
        {
          competitorId: ENJIN,
          meaning: `${meaning} `,
          move: "Post on X Nov 22.",
        },
      ),
      NAMES,
      new Set(["x"]),
    );

    expect(problems).toEqual([
      expect.stringContaining("almost the same meaning"),
    ]);
  });

  it("does not read the letter x in a word as the network", () => {
    const problems = cusoFeedProblems(
      feed({
        competitorId: ENJIN,
        meaning: "Enjin's launch explains its taxes page; NMKR has none.",
        move: "Add an example to the pricing page next week.",
      }),
      NAMES,
      new Set(),
    );

    expect(problems).toEqual([]);
  });
});
