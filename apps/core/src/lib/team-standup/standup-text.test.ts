import { describe, expect, it } from "vitest";
import {
  formatStandup,
  handoffMessage,
  isStandupHostMessage,
  lineIsEmpty,
  type StandupLine,
} from "./standup-text";

const soko: StandupLine = {
  agent: {
    kind: "sokoBot",
    id: "soko",
    name: "Soko",
    ownerName: "Robin Keller",
  },
  done: ["2 posts scheduled"],
  today: ['"DACH market study" (nobody has it yet)'],
  blocked: [],
};
const mira: StandupLine = {
  agent: { kind: "coworker", id: "mira", name: "Mira", ownerName: null },
  done: [],
  today: ['"Pricing research"', '"Pricing research"'],
  blocked: [
    {
      what: '"Langdock note" waits for an answer',
      waitsOn: { userId: "robin", name: "Robin Keller" },
    },
  ],
};

describe("stand-up text", () => {
  it("puts what needs a person first, then matches, agents and the summary", () => {
    const text = formatStandup({
      date: "Mon 23 Nov",
      lines: [soko, mira],
      matches: [
        {
          needingAgentId: "soko",
          offeringAgentId: "mira",
          need: "a DACH study",
          offer: "is researching DACH pricing",
        },
      ],
      summary: "Two posts went out; one Task waits on Robin.",
    });
    expect(text.split("\n")[0]).toBe(
      "**Stand-up · Mon 23 Nov** · 2 agents · 1 needs a person · 1 match",
    );
    const order = [
      "**Needs a person**",
      "@robin:",
      "**Matches**",
      "**Agents**",
      "**Soko (Robin Keller's assistant)**",
      "Two posts went out",
    ].map((part) => text.indexOf(part));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(text).toContain('today: "Pricing research" ·');
  });

  it("leaves out an agent with nothing done, due or blocked", () => {
    expect(lineIsEmpty({ ...soko, done: [], today: [] })).toBe(true);
    expect(lineIsEmpty(soko)).toBe(false);
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
