import { describe, expect, it } from "vitest";
import {
  CMO_COMPETITOR_WEEK_KEY,
  type CmoCompetitorWeek,
  cmoCompetitorWeekText,
  readCmoCompetitorWeek,
} from "./cmo-competitor-week.js";

const week: CmoCompetitorWeek = {
  checkDay: "2026-11-16",
  moves: [
    {
      competitor: "Calendly",
      text: "Calendly raised Standard from $10 to $12 per seat.",
      source: { label: "Calendly", url: "https://calendly.com/pricing" },
      big: true,
      meaning: "Your Teams plan is now the cheaper one.",
      move: "Lead your pricing page with the price per seat.",
    },
    {
      competitor: "Zcal",
      text: "Zcal added team pages.",
      source: null,
      big: false,
    },
  ],
};

describe("cmoCompetitorWeekText", () => {
  it("writes one message: a line per move, the big one called out", () => {
    expect(cmoCompetitorWeekText(week)).toBe(
      [
        "**What your competitors did this week**",
        [
          "- Calendly raised Standard from $10 to $12 per seat. ([Calendly](https://calendly.com/pricing))",
          "  - What this means for you: Your Teams plan is now the cheaper one.",
          "  - Suggested move: Lead your pricing page with the price per seat.",
          "- Zcal added team pages.",
        ].join("\n"),
        "Every move, with what it means for you and what to do about it, is on the Competitors tab.",
      ].join("\n\n"),
    );
  });
});

describe("readCmoCompetitorWeek", () => {
  it("reads the week a message carries", () => {
    expect(
      readCmoCompetitorWeek({
        soko_bot: { turn_id: "t" },
        [CMO_COMPETITOR_WEEK_KEY]: week,
      }),
    ).toEqual(week);
  });

  it.each([
    ["any other message", { soko_bot: { turn_id: "t" } }],
    ["no metadata", null],
    [
      "a week without moves",
      { [CMO_COMPETITOR_WEEK_KEY]: { checkDay: "2026-11-16", moves: [] } },
    ],
    [
      "a source that is no web address",
      {
        [CMO_COMPETITOR_WEEK_KEY]: {
          checkDay: "2026-11-16",
          moves: [
            {
              competitor: "Zcal",
              text: "Zcal added team pages.",
              source: { label: "x", url: "javascript:alert(1)" },
              big: false,
            },
          ],
        },
      },
    ],
  ])("reads %s as none", (_label, metadata) => {
    expect(readCmoCompetitorWeek(metadata)).toBeNull();
  });
});
