import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  turnFind: vi.fn(),
  findCuso: vi.fn(),
  reports: vi.fn(),
  workingStrategy: vi.fn(),
  readPlan: vi.fn(),
  moves: vi.fn(),
}));
// A Cuso version that reads on demand, whatever versions exist.
vi.mock("@sokosumi/soko-bot", async (importActual) => {
  const actual = await importActual<typeof import("@sokosumi/soko-bot")>();
  return {
    ...actual,
    getSokoBotVersion: (id: string | null) =>
      id === "cmo-reads"
        ? {
            ...actual.getSokoBotVersion("cmo-v21"),
            skills: [
              ...actual.getSokoBotVersion("cmo-v21").skills,
              actual.CMO_CONTEXT_ON_DEMAND_SKILL,
            ],
          }
        : actual.getSokoBotVersion(id),
  };
});
vi.mock("@/lib/db/prisma", () => ({
  default: { sokoBotTurn: { findUnique: mocks.turnFind } },
}));
vi.mock("@/services/cmo-cuso.service", () => ({
  findCusoForBot: mocks.findCuso,
}));
vi.mock("@/services/cmo-reports.service", () => ({
  listCmoReports: mocks.reports,
}));
vi.mock("@/services/cmo-strategy.service", () => ({
  cmoWorkingStrategy: mocks.workingStrategy,
  cmoTurnExecutesPlan: (turn: { clientTurnId: string | null }) =>
    turn.clientTurnId?.startsWith("cmo:production:") ?? false,
}));
vi.mock("@/services/marketing-strategy.service", () => ({
  readMarketingPlan: mocks.readPlan,
}));
vi.mock("@/services/brand-brain.service", () => ({
  parseBrandBrain: (value: unknown) => value ?? null,
}));
vi.mock("@/services/competitor-feed.service", () => ({
  recentCompetitorMoves: mocks.moves,
}));

import type {
  AuthorizedSokoBotRuntime,
  ExecuteSokoBotToolInput,
} from "../soko-bot-runtime.service";
import { CMO_READ_CAP_BYTES, executeCmoRead } from "./cmo-reads";

const NOW = new Date("2026-12-01T08:00:00Z");

function authorized(
  overrides: { versionId?: string; askedByKind?: string } = {},
): AuthorizedSokoBotRuntime {
  return {
    turn: {
      id: "turn-1",
      sokoBotId: "bot-1",
      versionId: overrides.versionId ?? "cmo-reads",
    },
    askedByKind: overrides.askedByKind ?? "OWNER",
  } as unknown as AuthorizedSokoBotRuntime;
}

function call(capability: string, input: unknown): ExecuteSokoBotToolInput {
  return { capability, input } as unknown as ExecuteSokoBotToolInput;
}

function piece(index: number, day: number, channel = "linkedin") {
  return {
    id: `piece-${index}`,
    date: `2026-12-${String(day).padStart(2, "0")}`,
    channel,
    format: "post",
    title: `Piece ${index}`,
    status: "drafted",
    pillar: index % 2 ? "Launches" : "How-tos",
    draft: "words ".repeat(200),
  };
}

describe("executeCmoRead", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.turnFind.mockResolvedValue({
      source: "CHAT",
      clientTurnId: "chat:1",
    });
    mocks.findCuso.mockResolvedValue({
      projectId: "project-1",
      brandBrain: {
        summary: "S",
        voice: { tone: "Plain" },
        audience: [],
        products: [],
        competitors: [],
        profile: {
          pricing: {
            headline: "Three plans",
            answer: "From 9 a month",
            findings: [{ text: "Starter costs 9", source: "https://x.io" }],
          },
        },
      },
    });
    mocks.workingStrategy.mockResolvedValue({ approvedAt: NOW });
    mocks.readPlan.mockResolvedValue({
      month: "2026-12",
      goals: ["More launches"],
      calendar: [
        piece(1, 2),
        piece(2, 3, "x"),
        piece(3, 20),
        piece(4, 22, "x"),
      ],
    });
  });

  it("reads only on a version with an organized context", async () => {
    await expect(
      executeCmoRead(
        call("read_strategy", { part: "goals" }),
        authorized({ versionId: "cmo-v21" }),
        NOW,
      ),
    ).rejects.toThrow(/organized context/);
    await expect(
      executeCmoRead(
        call("read_strategy", { part: "goals" }),
        authorized({ versionId: "v34" }),
        NOW,
      ),
    ).rejects.toThrow(/CMO assistant/);
  });

  it("never reads the plan for a teammate's question", async () => {
    await expect(
      executeCmoRead(
        call("read_calendar", {}),
        authorized({ askedByKind: "TEAMMATE" }),
        NOW,
      ),
    ).rejects.toThrow(/teammate/);
  });

  it("reads only the bot's own Project", async () => {
    mocks.moves.mockResolvedValue([]);
    await executeCmoRead(call("read_competitor_moves", {}), authorized(), NOW);
    expect(mocks.findCuso).toHaveBeenCalledWith("bot-1");
    expect(mocks.moves).toHaveBeenCalledWith(
      "project-1",
      NOW,
      expect.objectContaining({ take: 60 }),
    );
  });

  it("reads a range, narrowed by network, in full", async () => {
    const result = (await executeCmoRead(
      call("read_calendar", {
        from: "2026-12-01",
        to: "2026-12-07",
        network: "X",
      }),
      authorized(),
      NOW,
    )) as { pieces: { id: string; draft: string }[]; matched: number };
    expect(result.pieces.map((entry) => entry.id)).toEqual(["piece-2"]);
    expect(result.pieces[0]?.draft).toContain("words");
    expect(result.matched).toBe(1);
  });

  it("finds named pieces by id across the month", async () => {
    const result = (await executeCmoRead(
      call("read_calendar", { ids: ["piece-3", "piece-4"] }),
      authorized(),
      NOW,
    )) as { pieces: { id: string }[] };
    expect(result.pieces.map((entry) => entry.id)).toEqual([
      "piece-3",
      "piece-4",
    ]);
  });

  it("refuses a range longer than a month", async () => {
    await expect(
      executeCmoRead(
        call("read_calendar", { from: "2026-12-01", to: "2027-02-01" }),
        authorized(),
        NOW,
      ),
    ).rejects.toThrow(/at most 31 days/);
  });

  it("stops at the cap and counts the rest", async () => {
    mocks.readPlan.mockResolvedValue({
      month: "2026-12",
      calendar: Array.from({ length: 200 }, (_, index) => piece(index, 2)),
    });
    const result = (await executeCmoRead(
      call("read_calendar", { from: "2026-12-02", to: "2026-12-02" }),
      authorized(),
      NOW,
    )) as { pieces: unknown[]; more: number; note: string };
    expect(
      Buffer.byteLength(JSON.stringify(result.pieces)),
    ).toBeLessThanOrEqual(CMO_READ_CAP_BYTES);
    expect(result.pieces.length + result.more).toBe(200);
    expect(result.note).toMatch(/narrower range/);
  });

  it("says when nothing matches rather than leaving it to a guess", async () => {
    const result = (await executeCmoRead(
      call("read_calendar", { from: "2026-12-10", to: "2026-12-12" }),
      authorized(),
      NOW,
    )) as { note: string };
    expect(result.note).toMatch(/No piece matches/);
  });

  it("reads the approved version while it carries out the plan", async () => {
    mocks.turnFind.mockResolvedValue({
      source: "EVENT",
      clientTurnId: "cmo:production:bot:1:0",
    });
    await executeCmoRead(
      call("read_strategy", { part: "goals" }),
      authorized(),
      NOW,
    );
    expect(mocks.workingStrategy).toHaveBeenCalledWith("project-1", true);
  });

  it("reads a Brand Brain section with every finding", async () => {
    const result = (await executeCmoRead(
      call("read_brand_brain", { part: "pricing" }),
      authorized(),
      NOW,
    )) as { value: { findings: { text: string }[] } };
    expect(result.value.findings[0]?.text).toBe("Starter costs 9");
  });

  it("lists reports, then reads one by id", async () => {
    mocks.reports.mockResolvedValue([
      {
        id: "r-1",
        at: "2026-11-30T09:00:00Z",
        kind: "daily",
        headline: "Daily",
        done: [],
        upNext: [],
        changes: [],
        turnId: null,
      },
      {
        id: "r-2",
        at: "2026-11-23T09:00:00Z",
        kind: "weekly",
        headline: "LinkedIn carried the week",
        results: "LinkedIn reached 4,210 people.",
        previousVersionId: "v-old",
        done: [],
        upNext: [],
        changes: [],
        turnId: null,
      },
    ]);
    const listed = (await executeCmoRead(
      call("read_report", { kind: "weekly" }),
      authorized(),
      NOW,
    )) as { reports: { id: string }[] };
    expect(listed.reports.map((report) => report.id)).toEqual(["r-2"]);
    const one = (await executeCmoRead(
      call("read_report", { id: "r-2" }),
      authorized(),
      NOW,
    )) as { report: Record<string, unknown> };
    expect(one.report.results).toBe("LinkedIn reached 4,210 people.");
    expect(one.report.previousVersionId).toBeUndefined();
    await expect(
      executeCmoRead(call("read_report", { id: "nope" }), authorized(), NOW),
    ).rejects.toThrow(/No report has this id/);
  });
});
