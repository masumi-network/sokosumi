import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ evaluateWithJev: vi.fn() }));
vi.mock("@/lib/soko-bot/jev", () => ({ evaluateWithJev: m.evaluateWithJev }));

import {
  competitorStatements,
  landingPageProblems,
  pageOpening,
  unsupportedCompetitorClaims,
} from "./landing-page-check";

const PAGE = `# Cal.com vs Calendly: scheduling you can host yourself

Cal.com vs Calendly comes down to who owns the booking page. Cal.com is open source.

## Price

Calendly's Standard plan costs $12 per seat a month. Cal.com is free for one person.

| | Cal.com | Calendly |
| --- | --- | --- |
| Open source | Yes | No |

1. Sign up.
`;

const checked = (
  over: Partial<Parameters<typeof landingPageProblems>[0]> = {},
) =>
  landingPageProblems({
    keyword: "cal.com vs calendly",
    draft: PAGE,
    competitor: "Calendly",
    quotes: ["Standard $12 /seat/mo billed yearly"],
    ownFacts: "Free for individuals.",
    ...over,
  });

describe("pageOpening", () => {
  it("reads the H1 and the first paragraph, past a list or a table", () => {
    expect(
      pageOpening("# Title\n\n- a list\n\n| a | b |\n\nThe words."),
    ).toEqual({ heading: "Title", firstParagraph: "The words." });
  });

  it("has no H1 when the page starts with something else", () => {
    expect(pageOpening("Intro.\n\n# Title").heading).toBeNull();
  });
});

describe("competitorStatements", () => {
  it("keeps each sentence naming the competitor and each row of a table that does", () => {
    expect(competitorStatements(PAGE, "Calendly")).toEqual([
      "Cal.com vs Calendly: scheduling you can host yourself",
      "Cal.com vs Calendly comes down to who owns the booking page.",
      "Calendly's Standard plan costs $12 per seat a month.",
      "| | Cal.com | Calendly |\n| Open source | Yes | No |",
    ]);
  });

  it("does not take a longer name for the competitor", () => {
    expect(competitorStatements("Calendlyfy is new.", "Calendly")).toEqual([]);
  });
});

describe("landingPageProblems", () => {
  it("passes a page with the search in its H1 and first paragraph and sourced numbers", () => {
    expect(checked()).toEqual([]);
  });

  it("wants the search in the H1 word for word", () => {
    expect(
      checked({
        draft: PAGE.replace("# Cal.com vs Calendly", "# Calendly or us"),
      }),
    ).toEqual([
      'The H1 "Calendly or us: scheduling you can host yourself" does not hold the search "cal.com vs calendly" word for word.',
    ]);
  });

  it("wants the search in the first paragraph", () => {
    expect(
      checked({
        draft: PAGE.replace("Cal.com vs Calendly comes down", "It comes down"),
      }),
    ).toEqual([
      'The first paragraph does not hold the search "cal.com vs calendly" word for word.',
    ]);
  });

  it("wants an H1 on the first line", () => {
    expect(checked({ draft: `Intro.\n\n${PAGE}` })[0]).toMatch(
      /starts with its H1/,
    );
  });

  it("refuses a number beside the competitor that no source gives", () => {
    expect(
      checked({ draft: PAGE.replace("$12 per seat", "$16 per seat") }),
    ).toEqual([
      '"Calendly\'s Standard plan costs $16 per seat a month." has a number no source gives (16). Quote the source that says it, or leave it out.',
    ]);
  });

  it("lets a number stand that the business says about itself", () => {
    expect(
      checked({
        draft: `${PAGE}\nUnlike Calendly, Cal.com has 40 integrations.`,
        ownFacts: "40 integrations",
      }),
    ).toEqual([]);
  });

  it("refuses a page that names Sokosumi", () => {
    expect(checked({ draft: `${PAGE}\nMade with Sokosumi.` })).toEqual([
      "The page names Sokosumi.",
    ]);
  });
});

describe("unsupportedCompetitorClaims", () => {
  beforeEach(() => vi.resetAllMocks());

  it("asks nothing for a page that does not name the competitor", async () => {
    expect(
      await unsupportedCompetitorClaims({
        draft: "# Scheduling\n\nBook a time.",
        competitor: "Calendly",
        quotes: [],
      }),
    ).toEqual({ problems: [], costUsd: 0 });
    expect(m.evaluateWithJev).not.toHaveBeenCalled();
  });

  it("refuses what the sources do not say, and what Jev left unanswered", async () => {
    m.evaluateWithJev.mockResolvedValue({
      costUsd: 0.002,
      answers: new Map([
        ["s1", { type: "boolean", probability: 0.9 }],
        ["s2", { type: "boolean", probability: 0.1 }],
      ]),
    });

    const result = await unsupportedCompetitorClaims({
      draft:
        "# X\n\nCalendly has a free plan. Calendly is slow. Is Calendly for you?",
      competitor: "Calendly",
      quotes: ["Free: always free"],
    });

    expect(result).toEqual({
      costUsd: 0.002,
      problems: [
        '"Calendly is slow." says something about Calendly that no cited source says. Cite its own words for it, or leave it out.',
        '"Is Calendly for you?" could not be checked just now. Save it again.',
      ],
    });
  });
});
