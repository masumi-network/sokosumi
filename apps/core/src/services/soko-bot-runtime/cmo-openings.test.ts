import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/soko-bot/jev", () => ({ evaluateWithJev: vi.fn() }));

import {
  type CompareOpenings,
  cmoOpeningCandidates,
  cmoOpeningProblems,
  cmoOpeningRepeats,
  cmoPickOpening,
  withOpening,
} from "./cmo-openings";
import { cmoBestExamples, cmoExamplesLines } from "./cmo-writer-examples";

const DRAFT =
  "Routing forms pick the right rep.\n\nRho cut no-shows from 18% to 7% with two questions on its form.";

describe("cmoOpeningProblems", () => {
  it("passes a grounded statement", () => {
    expect(
      cmoOpeningProblems("Rho cut no-shows from 18% to 7%.", "linkedin", DRAFT),
    ).toEqual([]);
  });

  it("refuses a number the piece does not hold", () => {
    expect(
      cmoOpeningProblems("Rho cut no-shows by 60%.", "linkedin", DRAFT),
    ).toEqual(["a number the piece does not hold (60)"]);
  });

  it("matches numbers written with separators", () => {
    expect(
      cmoOpeningProblems(
        "Book.io minted 130,000 NFTs.",
        "x",
        "Book.io minted 130000 NFTs in a weekend.",
      ),
    ).toEqual([]);
  });

  it("refuses questions, hashtags, banned copy and long lines", () => {
    expect(
      cmoOpeningProblems("Still losing leads to bad routing?", "x", ""),
    ).toContain("a question");
    expect(
      cmoOpeningProblems("Routing is a game-changer #sales", "x", ""),
    ).toHaveLength(2);
    expect(cmoOpeningProblems("a".repeat(151), "linkedin", "")).toContain(
      "longer than 150 characters, cut before it reads",
    );
  });
});

describe("cmoOpeningCandidates", () => {
  it("keeps the draft's own line first and drops broken or repeated ones", () => {
    expect(
      cmoOpeningCandidates(
        DRAFT,
        [
          "Rho cut no-shows from 18% to 7%.",
          "routing forms pick the right rep.",
          "Rho cut no-shows by 60%.",
          "Why does routing matter?",
          "  Rho cut  no-shows from 18% to 7%. ",
        ],
        "linkedin",
        DRAFT,
      ),
    ).toEqual([
      "Routing forms pick the right rep.",
      "Rho cut no-shows from 18% to 7%.",
    ]);
  });
});

describe("cmoOpeningRepeats", () => {
  it("finds the same numbers or mostly the same words", () => {
    const taken = ["NMKR Studio minting costs 3% or a minimum of 2 ADA."];
    expect(cmoOpeningRepeats("Minting is 3% or 2 ADA a token.", taken)).toBe(
      true,
    );
    expect(
      cmoOpeningRepeats("NMKR Studio minting costs 3% or less.", taken),
    ).toBe(true);
    expect(cmoOpeningRepeats("Book.io sold 130,000 NFTs on NMKR.", taken)).toBe(
      false,
    );
  });

  it("drops a repeating own line when another candidate is left", () => {
    expect(
      cmoOpeningCandidates(
        DRAFT,
        ["Rho cut no-shows from 18% to 7%."],
        "linkedin",
        DRAFT,
        ["Routing forms pick the right rep for you."],
      ),
    ).toEqual(["Rho cut no-shows from 18% to 7%."]);
  });
});

describe("withOpening", () => {
  it("replaces only the first non-empty line", () => {
    expect(withOpening(`\n${DRAFT}`, "New line.")).toBe(
      "\nNew line.\n\nRho cut no-shows from 18% to 7% with two questions on its form.",
    );
  });
});

describe("cmoPickOpening", () => {
  const longerWins: CompareOpenings = async ({ a, b }) => ({
    aWins: a.length >= b.length,
    costUsd: 0.001,
  });

  it("runs a knockout and keeps the winner", async () => {
    const result = await cmoPickOpening({
      candidates: ["aa", "a", "aaaaa", "aaa", "aaaa"],
      channel: "x",
      businessName: "B",
      compare: longerWins,
    });
    expect(result.opening).toBe("aaaaa");
    expect(result.costUsd).toBeCloseTo(0.004);
  });

  it("keeps the earlier line when a comparison fails", async () => {
    const result = await cmoPickOpening({
      candidates: ["own", "other"],
      channel: "x",
      businessName: "B",
      compare: () => Promise.reject(new Error("down")),
    });
    expect(result.opening).toBe("own");
  });
});

describe("cmoBestExamples", () => {
  const text = (word: string) => `${word} ${"x".repeat(50)}`;

  it("keeps engaged, long enough posts per network, best first, once each", () => {
    const best = cmoBestExamples([
      { channel: "x", text: text("low"), engagement: 2, from: "own" },
      { channel: "x", text: text("high"), engagement: 9, from: "own" },
      { channel: "x", text: text("high"), engagement: 5, from: "Rival" },
      { channel: "x", text: "short", engagement: 50, from: "own" },
      { channel: "x", text: text("none"), engagement: 0, from: "own" },
      { channel: "instagram", text: text("ig"), engagement: 3, from: "Rival" },
    ]);
    expect(best.get("x")?.map((example) => example.text)).toEqual([
      text("high"),
      text("low"),
    ]);
    expect(best.get("instagram")).toHaveLength(1);
  });

  it("labels the business's own posts and competitors' by name", () => {
    expect(
      cmoExamplesLines([
        { channel: "x", text: "Ours\nhere", engagement: 4, from: "own" },
        { channel: "x", text: "Theirs", engagement: 3, from: "Rival" },
      ]),
    ).toContain("- [ours, 4] Ours here\n- [Rival, 3] Theirs");
  });
});
