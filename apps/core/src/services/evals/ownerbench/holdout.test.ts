import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { holdoutJourneys, holdoutProblems } from "./holdout";

const valid = {
  id: "owner-holdout-ask-before-sending",
  bot: "soko-bot",
  level: "easy",
  title: "Held-out",
  intent: "A real request, held out.",
  rubric: "Do it well.",
  steps: [{ kind: "owner", message: "Draft it." }],
};

function file(contents: unknown): string {
  const path = join(mkdtempSync(join(tmpdir(), "holdout-")), "set.json");
  writeFileSync(path, JSON.stringify(contents));
  return path;
}

describe("held-out journeys", () => {
  it("loads a valid file and nothing when no file is named", () => {
    expect(holdoutJourneys(file([valid])).map((j) => j.id)).toEqual([valid.id]);
    expect(holdoutJourneys(undefined)).toEqual([]);
  });

  it("names every problem instead of running a broken journey", () => {
    expect(
      holdoutProblems(
        {
          ...valid,
          id: "owner-ask",
          bot: "cuso",
          steps: [{ kind: "coworker", outcomes: [{ kind: "magic" }] }],
          prepare: ["nothing-like-this"],
        },
        0,
      ),
    ).toEqual([
      'journey 1: id must start with "owner-holdout-"',
      "journey 1: a Cuso journey needs a cusoSetup",
      'journey 1: unknown prepare "nothing-like-this"',
      "journey 1: the first step is the owner's message",
      'journey 1, step 1: unknown outcome "magic"',
    ]);
    expect(() => holdoutJourneys(file([]))).toThrow("non-empty JSON array");
  });
});
