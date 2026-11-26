import { describe, expect, it } from "vitest";
import {
  type AgentRecord,
  botFallbackMessage,
  emptyRecord,
  formatWeekInReview,
  handoffMessage,
  isStandupHostMessage,
  recordDone,
  recordIsEmpty,
  shortTitleByRules,
  standupOpener,
  withMentions,
} from "./standup-text";

const robin = { userId: "robin", name: "Robin Keller" };
const soko: AgentRecord = {
  ...emptyRecord({
    kind: "sokoBot",
    id: "soko",
    name: "Soko",
    ownerName: "Robin Keller",
  }),
  counts: ["2 posts scheduled", "1 Task created"],
  touched: ['created "DACH market study"'],
  open: ["Offsite venue"],
};
const mira: AgentRecord = {
  ...emptyRecord({
    kind: "coworker",
    id: "mira",
    name: "Mira",
    ownerName: null,
  }),
  finished: ["Weekly Competitor Intelligence — Top 3 Launches"],
  working: ["Pricing research", "Pricing research"],
  waiting: [
    { task: "Langdock note", failed: false, waitsOn: robin },
    { task: "Tender scan", failed: false, waitsOn: robin },
    { task: "Old export", failed: true, waitsOn: null },
  ],
};

describe("stand-up text", () => {
  it("opens with the date only", () => {
    expect(standupOpener("Tue 24 Nov")).toBe("**Stand-up · Tue 24 Nov**");
  });

  it("names Coworker work no bot speaks for in one opener line", () => {
    expect(
      standupOpener("Wed 25 Nov", [
        { id: "maya", name: "Maya", finished: ["content batch"], working: [] },
        { id: "elena", name: "Elena", finished: [], working: ["test Task"] },
      ]),
    ).toBe(
      "**Stand-up · Wed 25 Nov**\nAlso from Coworkers: Maya finished content batch; Elena is on test Task.",
    );
  });

  it("tells the Coworker work a bot handed out inside its fallback, grouped per person and Coworker", () => {
    const text = botFallbackMessage({
      ...soko,
      open: [],
      coworkers: [
        {
          id: "mira",
          name: "Mira",
          finished: ["competitor report"],
          working: ["Pricing research", "Pricing research"],
        },
      ],
      waiting: [
        { task: "Langdock note", failed: false, waitsOn: robin, by: "Mira" },
        { task: "Tender scan", failed: false, waitsOn: robin },
        { task: "Old export", failed: true, waitsOn: null },
      ],
    });
    expect(text).toBe(
      [
        "Since the last stand-up: 2 posts scheduled and 1 Task created.",
        "Mira finished competitor report, still on Pricing research.",
        "Mira waits on @robin: Langdock note.",
        "Waiting on @robin: Tender scan.",
        "Failed: Old export.",
      ].join("\n"),
    );
    expect(text).not.toContain('"');
  });

  it("falls back to the bot's record in the first person", () => {
    expect(botFallbackMessage(soko)).toBe(
      [
        "Since the last stand-up: 2 posts scheduled and 1 Task created.",
        "Open on Robin Keller's list, nobody has it yet: Offsite venue.",
      ].join("\n"),
    );
    expect(
      botFallbackMessage({
        ...soko,
        counts: [],
        open: [],
        waiting: [{ task: "Q1 plan", failed: false, waitsOn: robin }],
      }),
    ).toBe("Waiting on @robin: Q1 plan.");
  });

  it("says when there is nothing new at all", () => {
    expect(botFallbackMessage(emptyRecord(soko.agent))).toBe(
      "Nothing new since the last stand-up.",
    );
  });

  it("adds a mention for a waited-on person the bot's words left out", () => {
    expect(withMentions("I need Robin's OK.", [robin])).toBe(
      "I need Robin's OK.\ncc @robin",
    );
    expect(withMentions("I need @robin's OK.", [robin])).toBe(
      "I need @robin's OK.",
    );
  });

  it.each([
    [
      "Daily X engagement opportunities: Tech Startup AI — 2026-11-23",
      "Daily X engagement opportunities",
    ],
    [
      "Recherchebrief: Top 5 EU-Marktplätze für KI-Agenten",
      "Top 5 EU-Marktplätze für KI-Agenten",
    ],
    [
      "Weekly Competitor Intelligence — Top 3 Launches, Pricing & Market Gaps",
      "Weekly Competitor Intelligence",
    ],
    ["App UX: home, 2026-11-24", "App UX: home"],
    [
      "Wöchentliche Ausschreibungs-Recherche: DACH/EU (utxo AG)",
      "Wöchentliche Ausschreibungs-Recherche: DACH/EU",
    ],
    [
      "Weekly performance report comparing @MasumiNetwork and @Sokosumi",
      "Weekly performance report comparing…",
    ],
  ])("shortens %s by rules", (title, short) => {
    expect(shortTitleByRules(title)).toBe(short);
  });

  it("posts nothing for an agent with nothing done, due or blocked", () => {
    expect(recordIsEmpty(emptyRecord(soko.agent))).toBe(true);
    expect(recordIsEmpty(soko)).toBe(false);
  });

  it("keeps the week's words: counts for bots, quoted names for Coworkers", () => {
    expect(recordDone(soko)).toEqual(["2 posts scheduled", "1 Task created"]);
    expect(recordDone(mira)).toEqual([
      '"Weekly Competitor Intelligence — Top 3 Launches"',
    ]);
  });

  it("writes a hand-off as plain text a Coworker can read", () => {
    const text = handoffMessage({
      offeringHandle: "mira",
      need: "a DACH study",
      context: "Mira is researching DACH pricing.",
      askedFor: "Can you share it?",
    });
    expect(text).toMatch(/^@mira from today's stand-up: Can you share it\?/);
    for (const field of [
      "- Goal: a DACH study",
      "- Background:",
      "- What I need back:",
      "- By: today",
    ])
      expect(text).toContain(field);
  });

  it("knows its own messages: no sender and the stand-up marker", () => {
    const base = {
      senderUserId: null,
      senderCoworkerId: null,
      senderSokoBotId: null,
    };
    expect(
      isStandupHostMessage({
        ...base,
        metadata: { team_standup: { runId: "r" } },
      }),
    ).toBe(true);
    expect(isStandupHostMessage({ ...base, metadata: {} })).toBe(false);
    expect(
      isStandupHostMessage({
        ...base,
        senderSokoBotId: "b",
        metadata: { team_standup: {} },
      }),
    ).toBe(false);
  });
});

describe("formatWeekInReview", () => {
  it("writes one line per person and agent, counts in plain words, and says where to turn it off", () => {
    const text = formatWeekInReview({
      dates: "16 Nov – 22 Nov",
      people: [
        {
          userId: "u1",
          name: "Robin Keller",
          finished: ["A", "B", "C", "D"],
          answered: 1,
          assigned: 0,
          approved: { strategies: 2, newsletters: 0 },
          postsPublished: 3,
          filesShared: 0,
          tablesMade: 1,
        },
      ],
      agents: [{ agent: soko.agent, done: ["2 Tasks answered"] }],
      summary: " Four Tasks done. ",
    });
    expect(text.split("\n")[0]).toBe(
      "**Week in review · 16 Nov – 22 Nov** · 1 person · 1 agent",
    );
    expect(text).toContain(
      '- **Robin Keller** · 4 Tasks finished ("A", "B", "C" (+1)) · 1 Task answered · 2 strategies approved · 3 posts published · 1 table made',
    );
    expect(text).toContain("· 2 Tasks answered");
    expect(text).toContain("\nFour Tasks done.\n");
    expect(text).toContain(
      'turn off "Include my week in the stand-up" in [your account settings](/account)',
    );
  });
});
