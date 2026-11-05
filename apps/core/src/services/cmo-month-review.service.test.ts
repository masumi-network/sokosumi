import type { CmoCalendarEntry } from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { evaluateWithJev, updateMany, readPieceText, recordUsage } = vi.hoisted(
  () => ({
    evaluateWithJev: vi.fn(),
    updateMany: vi.fn(),
    readPieceText: vi.fn(),
    recordUsage: vi.fn(),
  }),
);

vi.mock("@/lib/soko-bot/jev", () => ({ evaluateWithJev }));
vi.mock("@/lib/db/prisma", () => ({
  default: { marketingStrategy: { updateMany } },
}));
vi.mock("@/services/marketing-strategy-files.service", () => ({
  readMarketingPieceText: readPieceText,
}));
vi.mock("@/services/soko-bot-billing.service", () => ({
  recordSokoBotCheckUsage: recordUsage,
}));

import {
  advanceCmoMonthReview,
  type CmoMonthReview,
  cmoCountedProblems,
  cmoPiecesToRewrite,
  cmoPillarShares,
  cmoPillarsOff,
  cmoRewriteMessage,
  readCmoMonth,
} from "./cmo-month-review.service";

const PILLARS = [
  { name: "Lead routing", share: 50, why: "Shows the core job" },
  { name: "Setup in minutes", share: 50 },
];
const VOICE = {
  tone: "Clear, direct, practical.",
  do: ["Name the feature"],
  dont: ["No hype words"],
  examples: ["Leads reach the right rep in seconds."],
};
const NOW = new Date("2026-11-04T10:00:00Z");

const entry = (
  id: string,
  patch: Partial<CmoCalendarEntry> = {},
): CmoCalendarEntry => ({
  id,
  date: "2026-11-10",
  channel: "linkedin",
  format: "post",
  title: `Piece ${id}`,
  status: "scheduled",
  pillar: "Lead routing",
  draft: `Words of ${id}`,
  ...patch,
});

const made = (id: string, channel = "linkedin") => ({
  id,
  channel,
  format: "post",
  title: id.toUpperCase(),
  text: id,
  problems: [],
});

type JevPiece = { pillar?: string; skill?: number; voice?: number };

/**
 * Jev's reading of each piece, in order, three pieces per call as the review
 * batches them: its pillar, and how sure it is of every skill rule and the voice.
 */
function jevReads(...pieces: JevPiece[]) {
  for (let start = 0; start < pieces.length; start += 3) {
    const batch = pieces.slice(start, start + 3);
    evaluateWithJev.mockImplementationOnce(
      async ({ questions }: { questions: Record<string, unknown> }) => ({
        answers: new Map(
          Object.keys(questions).flatMap((key): [string, unknown][] => {
            const [, kind, index] = key.match(/^([a-z]+)(\d+)(?:_\d+)?$/) ?? [];
            const piece = batch[Number(index)];
            if (!piece) return [];
            if (kind === "pillar")
              return piece.pillar
                ? [
                    [
                      key,
                      {
                        type: "choice",
                        choice: piece.pillar,
                        probabilities: {},
                      },
                    ],
                  ]
                : [];
            const probability = kind === "rule" ? piece.skill : piece.voice;
            return [
              [key, { type: "boolean", probability: probability ?? 0.9 }],
            ];
          }),
        ),
        costUsd: 0.001,
      }),
    );
  }
}

const review = (patch: Partial<CmoMonthReview> = {}): CmoMonthReview => ({
  round: 1,
  checkedAt: NOW.toISOString(),
  pieces: {},
  writing: {},
  ...patch,
});

beforeEach(() => {
  vi.clearAllMocks();
  updateMany.mockResolvedValue({ count: 1 });
});

describe("cmoPillarShares", () => {
  it("sets each pillar's planned share beside the share Jev read", () => {
    const shares = cmoPillarShares(
      PILLARS,
      review({
        pieces: {
          a: "Lead routing",
          b: "Lead routing",
          c: "Lead routing",
          d: null,
        },
      }),
    );
    expect(shares).toEqual([
      { name: "Lead routing", planned: 50, made: 75, pieces: 3 },
      { name: "Setup in minutes", planned: 50, made: 0, pieces: 0 },
    ]);
    expect(cmoPillarsOff(shares)).toBe(true);
  });

  it("accepts a month within the mix's tolerance", () => {
    expect(
      cmoPillarsOff([
        { name: "Lead routing", planned: 50, made: 55, pieces: 11 },
        { name: "Setup in minutes", planned: 50, made: 45, pieces: 9 },
      ]),
    ).toBe(false);
  });
});

describe("cmoPiecesToRewrite", () => {
  it("rewrites pieces still to come that read as another pillar while the shares are off", () => {
    const calendar = [
      entry("a"),
      entry("b", { pillar: "Setup in minutes" }),
      entry("c", { pillar: "Setup in minutes" }),
      entry("d", { pillar: "Setup in minutes", status: "published" }),
      entry("e", { pillar: "Setup in minutes" }),
      entry("f", { pillar: "Pricing" }),
    ];
    const pieces = {
      a: "Lead routing",
      b: "Lead routing",
      c: null,
      f: null,
      d: "Lead routing",
    };
    expect(
      cmoPiecesToRewrite(
        { pillars: PILLARS, calendar },
        review({ pieces }),
        NOW,
      ).map((piece) => [piece.id, piece.reasons]),
    ).toEqual([
      ["b", ["pillar Setup in minutes, but reads as Lead routing"]],
      ["c", ["pillar Setup in minutes, but reads as none of the pillars"]],
    ]);
  });

  it("leaves a piece on another pillar alone while the shares hold", () => {
    const calendar = [entry("a"), entry("b", { pillar: "Setup in minutes" })];
    expect(
      cmoPiecesToRewrite(
        { pillars: PILLARS, calendar },
        review({ pieces: { a: "Setup in minutes", b: "Lead routing" } }),
        NOW,
      ),
    ).toEqual([]);
  });

  it("rewrites a piece that misses its skill or the voice, saying which", () => {
    const calendar = [
      entry("a"),
      entry("b"),
      entry("c"),
      entry("d", { date: "2026-11-01" }),
      entry("e"),
      entry("f"),
    ];
    const writing = {
      a: {
        followsSkill: false,
        soundsLikeBrand: true,
        missed: [],
        problems: [],
      },
      b: {
        followsSkill: true,
        soundsLikeBrand: false,
        missed: [],
        problems: [],
      },
      c: {
        followsSkill: true,
        soundsLikeBrand: true,
        missed: [],
        problems: [],
      },
      d: {
        followsSkill: false,
        soundsLikeBrand: false,
        missed: [],
        problems: [],
      },
      e: {
        followsSkill: true,
        soundsLikeBrand: true,
        missed: [],
        problems: ["its Title is 72 characters; make it at most 60"],
      },
      f: {
        followsSkill: false,
        soundsLikeBrand: true,
        missed: ["The first line stands on its own."],
        problems: [],
      },
    };
    expect(
      cmoPiecesToRewrite(
        { pillars: [], calendar },
        review({ writing }),
        NOW,
      ).map((piece) => [piece.id, piece.reasons]),
    ).toEqual([
      ["a", ["misses its network's writing skill"]],
      ["b", ["does not sound like the brand"]],
      ["e", ["its Title is 72 characters; make it at most 60"]],
      ["f", ['misses "The first line stands on its own."']],
    ]);
  });
});

describe("readCmoMonth", () => {
  it("asks for each piece's pillar, skill and voice, and reads the answers", async () => {
    jevReads(
      { pillar: "p1", skill: 0.8, voice: 0.2 },
      { pillar: "none", skill: 0.1 },
      { pillar: "p0" },
    );
    const read = await readCmoMonth({
      pillars: PILLARS,
      voice: VOICE,
      pieces: [made("a"), made("b", "x"), made("c")],
    });
    expect(read.pieces).toEqual({
      a: "Setup in minutes",
      b: null,
      c: "Lead routing",
    });
    expect(read.writing).toMatchObject({
      a: { followsSkill: true, soundsLikeBrand: false, missed: [] },
      b: {
        followsSkill: false,
        soundsLikeBrand: true,
        missed: expect.arrayContaining([expect.stringMatching(/^One idea/)]),
      },
      c: { followsSkill: true, soundsLikeBrand: true, missed: [] },
    });
    const [call] = evaluateWithJev.mock.calls[0] ?? [];
    expect(call.questions.pillar0.criteria).toEqual({
      p0: "Lead routing: Shows the core job",
      p1: "Setup in minutes",
      none: "None of these topics",
    });
    expect(call.state.brandVoice).toEqual(VOICE);
    const instructions = (prefix: string) =>
      Object.entries(call.questions as Record<string, { instructions: string }>)
        .filter(([key]) => key.startsWith(prefix))
        .map(([, question]) => question.instructions)
        .join(" ");
    expect(instructions("rule1_")).toMatch(/One idea/);
    expect(instructions("rule0_")).not.toMatch(/One idea/);
    expect(instructions("rule0_")).not.toMatch(/1,500|voice examples/);
  });

  it("asks no voice question without a Brand Brain voice, and no pillar without pillars", async () => {
    jevReads({ skill: 0.9 });
    const read = await readCmoMonth({
      pillars: [],
      voice: null,
      pieces: [made("a")],
    });
    const [call] = evaluateWithJev.mock.calls[0] ?? [];
    const keys = Object.keys(call.questions);
    expect(keys.length).toBeGreaterThan(3);
    expect(keys.every((key) => key.startsWith("rule0_"))).toBe(true);
    expect(read.writing).toEqual({
      a: {
        followsSkill: true,
        soundsLikeBrand: true,
        missed: [],
        problems: [],
      },
    });
  });

  it("leaves a failed batch out, marked for nothing", async () => {
    evaluateWithJev.mockRejectedValueOnce(new Error("Jev down"));
    const read = await readCmoMonth({
      pillars: PILLARS,
      voice: VOICE,
      pieces: [made("a")],
    });
    expect(read).toEqual({ pieces: {}, writing: {}, costUsd: 0 });
  });
});

describe("cmoCountedProblems", () => {
  const description = "D".repeat(140);

  it("counts a page fix's title and description", () => {
    expect(
      cmoCountedProblems(
        "seo",
        "page_fix",
        `Page: https://acme.io\nTitle: ${"T".repeat(72)}\nDescription: ${"D".repeat(230)}\nHeading (H1): Acme`,
      ),
    ).toEqual([
      "its Title is 72 characters; make it at most 60",
      "its Description is 230 characters; make it 120 to 155",
    ]);
    expect(
      cmoCountedProblems(
        "seo",
        "page_fix",
        `Title: Lead routing for small teams | Acme\nDescription: ${description}`,
      ),
    ).toEqual([]);
  });

  it("wants an article's description line and its # title", () => {
    expect(
      cmoCountedProblems("seo", "article", "How to route leads\n\nText"),
    ).toEqual(["it has no Description line", "it has no # title"]);
    expect(
      cmoCountedProblems(
        "seo",
        "article",
        `Description: ${description}\n\n# How to route leads`,
      ),
    ).toEqual([]);
  });

  it("wants a newsletter's subject and preview, and leaves social posts to their save", () => {
    expect(cmoCountedProblems("newsletter", "issue", "Hi,\n\nNews.")).toEqual([
      "it has no Subject line",
      "it has no Preview line",
    ]);
    expect(
      cmoCountedProblems(
        "newsletter",
        "issue",
        "Subject: The 3 breads we are dropping\nPreview: And why.",
      ),
    ).toEqual([]);
    expect(cmoCountedProblems("linkedin", "post", "**Bold** wall")).toEqual([]);
  });
});

describe("cmoRewriteMessage", () => {
  it("lists each piece with its reasons and hands over its channel's skills", () => {
    const message = cmoRewriteMessage({
      businessName: "acme.io",
      shares: [{ name: "Lead routing", planned: 50, made: 75, pieces: 3 }],
      pieces: [
        {
          ...entry("c", { channel: "x" }),
          reasons: ["misses its network's writing skill"],
          offPillar: true,
        },
      ],
    });
    expect(message).toContain("- Lead routing: plan 50%, made 75% (3 pieces)");
    expect(message).toContain(
      '- c · x/post · "Piece c" · misses its network\'s writing skill',
    );
    expect(message).toContain('<skill id="x">');
    expect(message).not.toContain('<skill id="linkedin">');
    expect(message).toContain("DONE:");
  });

  it("leaves the pillar shares out when no piece here is off its pillar", () => {
    const message = cmoRewriteMessage({
      businessName: "acme.io",
      shares: [{ name: "Lead routing", planned: 50, made: 75, pieces: 3 }],
      pieces: [
        {
          ...entry("c"),
          reasons: ["misses its network's writing skill"],
          offPillar: false,
        },
      ],
    });
    expect(message).not.toContain("These pillars are off the plan");
  });
});

describe("advanceCmoMonthReview", () => {
  const startRewrite = vi.fn();
  const base = {
    sokoBotId: "bot-1",
    businessName: "acme.io",
    voice: VOICE,
    strategy: {
      pillars: PILLARS,
      calendar: [
        entry("a"),
        entry("b"),
        entry("c", { pillar: "Setup in minutes" }),
        entry("d", { pillar: "Setup in minutes" }),
      ],
    },
    runIdPrefix: "cmo-production:bot-1:1:",
    ready: 4,
    now: NOW,
    startRewrite,
  };

  it("starts one rewrite run when the month is off its pillars, and bills the read", async () => {
    jevReads(
      { pillar: "p0" },
      { pillar: "p0" },
      { pillar: "p0" },
      { pillar: "p1" },
    );
    await advanceCmoMonthReview({
      ...base,
      version: { id: "v1", monthReview: null },
      runs: [],
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          monthReview: expect.objectContaining({
            round: 1,
            rewriteRunId: "cmo-production:bot-1:1:review:4",
          }),
        },
      }),
    );
    const [message, runId] = startRewrite.mock.calls[0] ?? [];
    expect(runId).toBe("cmo-production:bot-1:1:review:4");
    expect(message).toContain("- Lead routing: plan 50%, made 75% (3 pieces)");
    expect(message).toContain(
      '- c · linkedin/post · "Piece c" · pillar Setup in minutes, but reads as Lead routing',
    );
    expect(message).not.toContain("- d ·");
    expect(recordUsage).toHaveBeenCalledWith({
      sokoBotId: "bot-1",
      key: "cmo-review:v1:1",
      costUsd: 0.002,
    });
  });

  it("rewrites a piece that misses its skill even when the pillars hold", async () => {
    jevReads(
      { pillar: "p0" },
      { pillar: "p0", skill: 0.1 },
      { pillar: "p1" },
      { pillar: "p1" },
    );
    await advanceCmoMonthReview({
      ...base,
      version: { id: "v1", monthReview: null },
      runs: [],
    });
    const [message] = startRewrite.mock.calls[0] ?? [];
    expect(message).toContain('- b · linkedin/post · "Piece b" · misses "');
    expect(message).not.toContain("These pillars are off the plan");
  });

  it("stores the review and rewrites nothing when every piece holds", async () => {
    jevReads(
      { pillar: "p0" },
      { pillar: "p0" },
      { pillar: "p1" },
      { pillar: "p1" },
    );
    await advanceCmoMonthReview({
      ...base,
      version: { id: "v1", monthReview: null },
      runs: [],
    });
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(startRewrite).not.toHaveBeenCalled();
  });

  it("starts nothing when another sync stored the review first", async () => {
    jevReads(
      { pillar: "p0" },
      { pillar: "p0" },
      { pillar: "p0" },
      { pillar: "p1" },
    );
    updateMany.mockResolvedValueOnce({ count: 0 });
    await advanceCmoMonthReview({
      ...base,
      version: { id: "v1", monthReview: null },
      runs: [],
    });
    expect(startRewrite).not.toHaveBeenCalled();
  });

  it("reads the month again once the rewrite ends, and never rewrites twice", async () => {
    const first = review({
      pieces: { a: "Lead routing" },
      rewriteRunId: "cmo-production:bot-1:1:review:4",
    });
    await advanceCmoMonthReview({
      ...base,
      version: { id: "v1", monthReview: first },
      runs: [{ clientTurnId: first.rewriteRunId!, status: "RUNNING" }],
    });
    expect(evaluateWithJev).not.toHaveBeenCalled();

    jevReads(
      { pillar: "p0", skill: 0.1 },
      { pillar: "p0" },
      { pillar: "p0" },
      { pillar: "p1" },
    );
    await advanceCmoMonthReview({
      ...base,
      version: { id: "v1", monthReview: first },
      runs: [{ clientTurnId: first.rewriteRunId!, status: "COMPLETED" }],
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { monthReview: expect.objectContaining({ round: 2 }) },
      }),
    );
    expect(startRewrite).not.toHaveBeenCalled();
    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ key: "cmo-review:v1:2" }),
    );
  });

  it("reads a review stored before writing was checked", async () => {
    await advanceCmoMonthReview({
      ...base,
      version: {
        id: "v1",
        monthReview: { round: 1, checkedAt: NOW.toISOString(), pieces: {} },
      },
      runs: [],
    });
    expect(evaluateWithJev).not.toHaveBeenCalled();
  });

  it("reads a Project file's words for a piece that is not a Social post", async () => {
    readPieceText.mockResolvedValue("The whole article");
    jevReads({ pillar: "p1" });
    await advanceCmoMonthReview({
      ...base,
      strategy: {
        pillars: PILLARS,
        calendar: [
          entry("f", {
            channel: "seo",
            format: "article",
            draft: undefined,
            fileId: "file-1",
          }),
        ],
      },
      version: { id: "v1", monthReview: null },
      runs: [],
    });
    const [call] = evaluateWithJev.mock.calls[0] ?? [];
    expect(call.state.pieces[0].text).toBe("The whole article");
    const asked = Object.values(
      call.questions as Record<string, { instructions: string }>,
    )
      .map((question) => question.instructions)
      .join(" ");
    expect(asked).toMatch(/Article:/);
    expect(asked).not.toMatch(/Page fix/);
  });
});
