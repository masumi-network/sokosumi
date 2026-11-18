import type { CmoSaveCompetitorFeedInput } from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";

const jev = vi.hoisted(() => ({ evaluateWithJev: vi.fn() }));
vi.mock("@/lib/soko-bot/jev", () => jev);

import {
  type CitableSignal,
  factSupportProblems,
  feedProblems,
  isBigMove,
  moveRank,
  unsupportedNumbers,
} from "./feed-check";

const CALENDLY = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const ZCAL = "aaaaaaaa-aaaa-4aaa-8aaa-000000000002";
const PRICE = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";
const NEWS = "bbbbbbbb-bbbb-4bbb-8bbb-000000000002";
const ZCAL_NEWS = "bbbbbbbb-bbbb-4bbb-8bbb-000000000003";

function signal(overrides: Partial<CitableSignal>): CitableSignal {
  return {
    id: PRICE,
    competitorId: CALENDLY,
    kind: "PRICE_CHANGE",
    summary: "Standard plan $10 -> $12 per seat",
    quote: "$12 per seat/month",
    sourceTitle: "Calendly pricing",
    sourcePublisher: "Calendly",
    observedAt: new Date("2026-11-16T09:00:00Z"),
    raw: { prices: { before: ["$10"], after: ["$12"] } },
    ...overrides,
  };
}

const SIGNALS = new Map(
  [
    signal({}),
    signal({
      id: NEWS,
      kind: "NEWS",
      summary: "Calendly launched an AI notetaker on paid plans",
      quote: "The notetaker is available on all paid plans.",
      raw: {},
    }),
    signal({
      id: ZCAL_NEWS,
      competitorId: ZCAL,
      kind: "NEWS",
      summary: "Zcal added team pages",
      raw: {},
    }),
  ].map((item) => [item.id, item]),
);
const COMPETITORS = new Map([
  [CALENDLY, "Calendly"],
  [ZCAL, "Zcal"],
]);

function feed(
  facts: CmoSaveCompetitorFeedInput["items"][number]["facts"],
  overrides: Partial<CmoSaveCompetitorFeedInput["items"][number]> = {},
): CmoSaveCompetitorFeedInput {
  return {
    items: [
      {
        competitorId: CALENDLY,
        facts,
        meaning: "Our Teams plan is now the cheaper one for small teams.",
        move: "Lead next week's LinkedIn posts with the price per seat.",
        ...overrides,
      },
    ],
    openQuestions: [],
  };
}

describe("unsupportedNumbers", () => {
  it("finds numbers no source says, however they are written", () => {
    expect(
      unsupportedNumbers("Price went from $10 to $12, a 20% rise", [
        "$10 -> $12",
      ]),
    ).toEqual(["20"]);
    expect(unsupportedNumbers("Now 1,200 a year", ["$1200/yr"])).toEqual([]);
  });
});

describe("feedProblems", () => {
  it("passes a feed that only says what its signals say", () => {
    expect(
      feedProblems(
        feed([
          {
            text: "Calendly raised Standard from $10 to $12 per seat.",
            signalIds: [PRICE],
            support: "strong",
          },
        ]),
        SIGNALS,
        COMPETITORS,
        "",
      ),
    ).toEqual([]);
  });

  it("refuses an invented number, a foreign id and another competitor's signal", () => {
    const problems = feedProblems(
      feed([
        {
          text: "Calendly raised Standard to $12, losing 15% of teams.",
          signalIds: [PRICE],
          support: "strong",
        },
        {
          text: "Calendly signed a partner.",
          signalIds: ["cccccccc-cccc-4ccc-8ccc-000000000009"],
          support: "weak",
        },
        {
          text: "Calendly added team pages.",
          signalIds: [ZCAL_NEWS],
          support: "strong",
        },
      ]),
      SIGNALS,
      COMPETITORS,
      "",
    );
    expect(problems).toEqual([
      expect.stringContaining("has 15, which its signals do not say"),
      expect.stringContaining(
        "cites a signal id check_competitors did not give you",
      ),
      expect.stringContaining("cites a signal about another competitor"),
    ]);
  });

  it("refuses a competitor the owner does not track", () => {
    expect(
      feedProblems(
        feed([{ text: "Zoom launched.", signalIds: [NEWS], support: "weak" }], {
          competitorId: "dddddddd-dddd-4ddd-8ddd-000000000001",
        }),
        SIGNALS,
        COMPETITORS,
        "",
      ),
    ).toEqual(["Item 1: competitorId is not a competitor the owner tracks."]);
  });

  it("refuses Sokosumi anywhere the owner reads", () => {
    expect(
      feedProblems(
        {
          ...feed(
            [
              {
                text: "Calendly launched a notetaker.",
                signalIds: [NEWS],
                support: "strong",
              },
            ],
            { move: "Build it in Sokosumi." },
          ),
        },
        SIGNALS,
        COMPETITORS,
        "",
      ),
    ).toEqual(["Never name Sokosumi: write for the owner's business only."]);
  });
});

describe("feedProblems on meaning and move", () => {
  const fact = {
    text: "Calendly raised Standard from $10 to $12 per seat.",
    signalIds: [PRICE],
    support: "strong" as const,
  };

  it("lets meaning and move use the owner's own numbers", () => {
    expect(
      feedProblems(
        feed([fact], { meaning: "Our Teams plan at $15 is now close." }),
        SIGNALS,
        COMPETITORS,
        '{"offers":[{"name":"Teams","price":"$15 a month"}]}',
      ),
    ).toEqual([]);
  });

  it("refuses a number neither the signals nor the Brand Brain say", () => {
    expect(
      feedProblems(
        feed([fact], { move: "Cut our price by 30% before Friday." }),
        SIGNALS,
        COMPETITORS,
        "{}",
      ),
    ).toEqual([
      "Item 1 (Calendly): its move has 30, which neither its signals nor the Brand Brain say.",
    ]);
  });

  it("lets a move say when", () => {
    expect(
      feedProblems(
        feed([fact], {
          move: "Update the comparison page by Nov 21, or on 2026-11-24 at the latest.",
        }),
        SIGNALS,
        COMPETITORS,
        "{}",
      ),
    ).toEqual([]);
  });

  it("refuses a week with neither a move nor an open question", () => {
    expect(
      feedProblems({ items: [], openQuestions: [] }, SIGNALS, COMPETITORS, ""),
    ).toEqual([
      "A week without moves says what is still open: list it in openQuestions.",
    ]);
  });

  it("refuses a number in an open question no signal says", () => {
    expect(
      feedProblems(
        { items: [], openQuestions: ["Did Calendly lose 40 customers?"] },
        SIGNALS,
        COMPETITORS,
        "",
      ),
    ).toEqual([
      '"Did Calendly lose 40 customers?" has 40, which no signal says.',
    ]);
  });

  it("does not take a number from a signal's stored diff lines", () => {
    const withDiff = new Map(SIGNALS);
    withDiff.set(
      PRICE,
      signal({ raw: { prices: {}, added: ["Over 100,000 teams"] } }),
    );
    expect(
      feedProblems(
        feed([{ ...fact, text: "Calendly serves 100,000 teams." }]),
        withDiff,
        COMPETITORS,
        "",
      ),
    ).toEqual([
      expect.stringContaining("has 100000, which its signals do not say"),
    ]);
  });
});

describe("isBigMove", () => {
  it.each([
    ["a price change", [signal({})], true],
    [
      "a launch in the news",
      [signal({ kind: "NEWS", summary: "Calendly launched an AI notetaker" })],
      true,
    ],
    [
      "an ad burst",
      [signal({ kind: "AD", summary: "4 new ads", raw: { count: 4 } })],
      true,
    ],
    [
      "one new ad",
      [signal({ kind: "AD", summary: "1 new ad", raw: { count: 1 } })],
      false,
    ],
    [
      "a new product on the site",
      [signal({ kind: "WEBSITE_CHANGE", raw: { about: "product" } })],
      true,
    ],
    [
      "a reworded headline",
      [signal({ kind: "WEBSITE_CHANGE", raw: { about: "positioning" } })],
      false,
    ],
    [
      "an event in the news",
      [signal({ kind: "NEWS", summary: "Stumptown hosts a tasting in LA" })],
      false,
    ],
    [
      "an Instagram week",
      [signal({ kind: "SOCIAL", summary: "3 posts" })],
      false,
    ],
  ])("reads %s as big: %s", (_label, signals, big) => {
    expect(isBigMove(signals)).toBe(big);
  });
});

describe("moveRank", () => {
  it("ranks a price change above a launch above an ad burst", () => {
    const launch = signal({
      kind: "NEWS",
      summary: "Zcal launched team pages",
    });
    const ads = signal({ kind: "AD", summary: "5 new ads", raw: { count: 5 } });
    expect(moveRank([launch, signal({})])).toBe(0);
    expect(moveRank([ads, launch])).toBe(1);
    expect(moveRank([ads])).toBe(2);
    expect(
      moveRank([signal({ kind: "SOCIAL", summary: "3 posts" })]),
    ).toBeNull();
  });
});

describe("factSupportProblems", () => {
  const facts = feed([
    {
      text: "Calendly raised Standard from $10 to $12 per seat.",
      signalIds: [PRICE],
      support: "strong",
    },
    {
      text: "Calendly launched an AI notetaker.",
      signalIds: [NEWS],
      support: "strong",
    },
    {
      text: "Calendly's notetaker is aimed at sales teams.",
      signalIds: [NEWS],
      support: "weak",
    },
  ]);

  beforeEach(() => {
    jev.evaluateWithJev.mockReset();
  });

  function answers(...probabilities: number[]) {
    jev.evaluateWithJev.mockResolvedValue({
      answers: new Map([
        ...probabilities.map(
          (probability, index) =>
            [`item0fact${index}`, { type: "boolean", probability }] as const,
        ),
        ["item0advice", { type: "boolean", probability: 0.9 }] as const,
      ]),
      costUsd: 0.001,
    });
  }

  it("passes facts their sources back, at the support they claim", async () => {
    answers(0.95, 0.9, 0.5);
    expect(await factSupportProblems(facts, SIGNALS)).toEqual({
      problems: [],
      costUsd: 0.001,
    });
    const { state } = jev.evaluateWithJev.mock.calls[0]?.[0];
    expect(state.claims[0].sources[0]).toContain("$12 per seat/month");
  });

  it("refuses a fact its sources do not say", async () => {
    answers(0.95, 0.1, 0.5);
    expect((await factSupportProblems(facts, SIGNALS)).problems).toEqual([
      '"Calendly launched an AI notetaker." is not what its signals say. Say only what they say, or leave it out.',
    ]);
  });

  it("asks for weak when a strong fact is backed only in part", async () => {
    answers(0.5, 0.9, 0.5);
    expect((await factSupportProblems(facts, SIGNALS)).problems).toEqual([
      expect.stringContaining("mark it weak"),
    ]);
  });

  it("refuses a claim Jev left unanswered", async () => {
    jev.evaluateWithJev.mockResolvedValue({
      answers: new Map([["item0fact0", { type: "boolean", probability: 0.9 }]]),
      costUsd: 0.001,
    });
    const { problems } = await factSupportProblems(facts, SIGNALS);
    expect(problems).toContain(
      '"Calendly launched an AI notetaker." could not be checked just now. Save the feed again.',
    );
  });

  it("refuses meaning or move that claims what the signals do not", async () => {
    answers(0.95, 0.9, 0.5);
    jev.evaluateWithJev.mockResolvedValue({
      answers: new Map([
        ["item0fact0", { type: "boolean", probability: 0.95 }],
        ["item0fact1", { type: "boolean", probability: 0.9 }],
        ["item0fact2", { type: "boolean", probability: 0.5 }],
        ["item0advice", { type: "boolean", probability: 0.1 }],
      ]),
      costUsd: 0.001,
    });
    expect((await factSupportProblems(facts, SIGNALS)).problems).toEqual([
      expect.stringContaining(
        "says something about the competitor that its signals do not",
      ),
    ]);
    const { questions } = jev.evaluateWithJev.mock.calls.at(-1)?.[0];
    expect(questions.item0advice.instructions).toContain(
      "Claims about the advised business and suggestions are fine",
    );
  });

  it("asks Jev nothing for a quiet week", async () => {
    expect(
      await factSupportProblems({ items: [], openQuestions: ["?"] }, SIGNALS),
    ).toEqual({ problems: [], costUsd: 0 });
    expect(jev.evaluateWithJev).not.toHaveBeenCalled();
  });
});
