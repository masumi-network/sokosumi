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

function file(name: string, contents: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "holdout-")), name);
  writeFileSync(path, contents);
  return path;
}

describe("held-out journeys", () => {
  it("loads a JSON file, a module's HELDOUT_JOURNEYS, and nothing when no file is named", () => {
    expect(
      holdoutJourneys(file("set.json", JSON.stringify([valid]))).map(
        (journey) => journey.id,
      ),
    ).toEqual([valid.id]);
    expect(
      holdoutJourneys(
        file(
          "set.cjs",
          `module.exports = { HELDOUT_JOURNEYS: ${JSON.stringify([valid])} };`,
        ),
      ).map((journey) => journey.id),
    ).toEqual([valid.id]);
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
      "journey 1: the first step is a member's message",
      'journey 1, step 1: unknown outcome "magic"',
    ]);
    expect(() => holdoutJourneys(file("set.json", "[]"))).toThrow(
      "non-empty array",
    );
  });

  it("needs a prepare's fixtures and a teammate step's room", () => {
    expect(
      holdoutProblems(
        {
          ...valid,
          prepare: ["tasks"],
          steps: [
            { kind: "teammate", member: "Jordan", message: "Post this." },
            {
              kind: "owner",
              message: "Fine.",
              outcomes: [{ kind: "taskReply" }, { kind: "noHires" }],
            },
          ],
        },
        0,
      ),
    ).toEqual([
      'journey 1: prepare "tasks" needs fixtures.tasks',
      "journey 1, step 1: the teammate must be Hannah or Alex",
      "journey 1, step 1: a teammate step needs the teammate-room",
    ]);
    expect(
      holdoutProblems(
        {
          ...valid,
          prepare: ["teammate-room", "agent"],
          fixtures: {
            agent: { name: "Agent", description: "Does it.", credits: 3 },
          },
          steps: [{ kind: "teammate", member: "Alex", message: "Post this." }],
        },
        0,
      ),
    ).toEqual([]);
  });
});
