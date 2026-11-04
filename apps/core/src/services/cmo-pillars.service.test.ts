import type { CmoCalendarEntry } from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { evaluateWithJev, updateMany, readPieceText } = vi.hoisted(() => ({
  evaluateWithJev: vi.fn(),
  updateMany: vi.fn(),
  readPieceText: vi.fn(),
}));

vi.mock("@/lib/soko-bot/jev", () => ({ evaluateWithJev }));
vi.mock("@/lib/db/prisma", () => ({
  default: { marketingStrategy: { updateMany } },
}));
vi.mock("@/services/marketing-strategy-files.service", () => ({
  readMarketingPieceText: readPieceText,
}));

import {
  advanceCmoPillars,
  type CmoPillarCheck,
  cmoPiecesOffPillar,
  cmoPillarShares,
  cmoPillarsOff,
  readCmoPillars,
} from "./cmo-pillars.service";

const PILLARS = [
  { name: "Lead routing", share: 50, why: "Shows the core job" },
  { name: "Setup in minutes", share: 50 },
];
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

/** Jev answers each question of a batch with the pillar index given. */
function jevReads(...choices: string[]) {
  evaluateWithJev.mockImplementationOnce(
    async ({ questions }: { questions: Record<string, unknown> }) => ({
      answers: new Map(
        Object.keys(questions).map((key, index) => [
          key,
          { type: "choice", choice: choices[index], probabilities: {} },
        ]),
      ),
      costUsd: 0.001,
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  updateMany.mockResolvedValue({ count: 1 });
});

describe("cmoPillarShares", () => {
  it("sets each pillar's planned share beside the share Jev read", () => {
    const check: CmoPillarCheck = {
      round: 1,
      checkedAt: NOW.toISOString(),
      pieces: {
        a: "Lead routing",
        b: "Lead routing",
        c: "Lead routing",
        d: null,
      },
    };
    const shares = cmoPillarShares(PILLARS, check);
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

describe("cmoPiecesOffPillar", () => {
  it("rewrites pieces still to come that read as another pillar", () => {
    const check: CmoPillarCheck = {
      round: 1,
      checkedAt: NOW.toISOString(),
      pieces: {
        a: "Lead routing",
        b: "Lead routing",
        c: null,
        f: null,
        d: "Lead routing",
      },
    };
    const calendar = [
      entry("a"),
      entry("b", { pillar: "Setup in minutes" }),
      entry("c", { pillar: "Setup in minutes" }),
      entry("d", { pillar: "Setup in minutes", status: "published" }),
      entry("e", { pillar: "Setup in minutes" }),
      entry("f", { pillar: "Pricing" }),
    ];
    expect(
      cmoPiecesOffPillar(PILLARS, calendar, check, NOW).map((piece) => [
        piece.id,
        piece.readAs,
      ]),
    ).toEqual([
      ["b", "Lead routing"],
      ["c", null],
    ]);
  });
});

describe("readCmoPillars", () => {
  it("maps Jev's choice to the pillar's name and none to null", async () => {
    jevReads("p1", "none", "p0");
    const read = await readCmoPillars(PILLARS, [
      { id: "a", title: "A", text: "a" },
      { id: "b", title: "B", text: "b" },
      { id: "c", title: "C", text: "c" },
    ]);
    expect(read.pieces).toEqual({
      a: "Setup in minutes",
      b: null,
      c: "Lead routing",
    });
    const [call] = evaluateWithJev.mock.calls[0] ?? [];
    expect(call.questions.piece0.criteria).toEqual({
      p0: "Lead routing: Shows the core job",
      p1: "Setup in minutes",
      none: "None of these topics",
    });
  });

  it("leaves a failed batch out of the count", async () => {
    evaluateWithJev.mockRejectedValueOnce(new Error("Jev down"));
    const read = await readCmoPillars(PILLARS, [
      { id: "a", title: "A", text: "a" },
    ]);
    expect(read.pieces).toEqual({});
  });
});

describe("advanceCmoPillars", () => {
  const startRewrite = vi.fn();
  const base = {
    businessName: "acme.io",
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

  it("starts one rewrite run when the made month is off its pillars", async () => {
    jevReads("p0", "p0", "p0", "p1");
    await advanceCmoPillars({
      ...base,
      version: { id: "v1", pillarCheck: null },
      runs: [],
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          pillarCheck: expect.objectContaining({
            round: 1,
            rewriteRunId: "cmo-production:bot-1:1:pillars:4",
          }),
        },
      }),
    );
    const [message, runId] = startRewrite.mock.calls[0] ?? [];
    expect(runId).toBe("cmo-production:bot-1:1:pillars:4");
    expect(message).toContain("- Lead routing: plan 50%, made 75% (3 pieces)");
    expect(message).toContain(
      '- c · linkedin/post · pillar Setup in minutes · reads as Lead routing · "Piece c"',
    );
    expect(message).not.toContain("- d ·");
  });

  it("stores the check and rewrites nothing when the pillars hold", async () => {
    jevReads("p0", "p0", "p1", "p1");
    await advanceCmoPillars({
      ...base,
      version: { id: "v1", pillarCheck: null },
      runs: [],
    });
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(startRewrite).not.toHaveBeenCalled();
  });

  it("starts nothing when another sync stored the check first", async () => {
    jevReads("p0", "p0", "p0", "p1");
    updateMany.mockResolvedValueOnce({ count: 0 });
    await advanceCmoPillars({
      ...base,
      version: { id: "v1", pillarCheck: null },
      runs: [],
    });
    expect(startRewrite).not.toHaveBeenCalled();
  });

  it("reads the month again once the rewrite ends, and never rewrites twice", async () => {
    const first: CmoPillarCheck = {
      round: 1,
      checkedAt: NOW.toISOString(),
      pieces: { a: "Lead routing" },
      rewriteRunId: "cmo-production:bot-1:1:pillars:4",
    };
    await advanceCmoPillars({
      ...base,
      version: { id: "v1", pillarCheck: first },
      runs: [{ clientTurnId: first.rewriteRunId!, status: "RUNNING" }],
    });
    expect(evaluateWithJev).not.toHaveBeenCalled();

    jevReads("p0", "p0", "p0", "p1");
    await advanceCmoPillars({
      ...base,
      version: { id: "v1", pillarCheck: first },
      runs: [{ clientTurnId: first.rewriteRunId!, status: "COMPLETED" }],
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { pillarCheck: expect.objectContaining({ round: 2 }) },
      }),
    );
    expect(startRewrite).not.toHaveBeenCalled();
  });

  it("reads a Project file's words for a piece that is not a Social post", async () => {
    readPieceText.mockResolvedValue("The whole article");
    jevReads("p1");
    await advanceCmoPillars({
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
      version: { id: "v1", pillarCheck: null },
      runs: [],
    });
    const [call] = evaluateWithJev.mock.calls[0] ?? [];
    expect(call.state.pieces[0].text).toBe("The whole article");
  });
});
