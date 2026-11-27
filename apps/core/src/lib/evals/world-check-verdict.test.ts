import { describe, expect, it } from "vitest";
import {
  journeyProblems,
  resultInvalid,
  type WorldCheckRun,
} from "./world-check-verdict";

const pass = { label: "1. Posts", pass: true };
const fail = { label: "1. Posts", pass: false, actual: "0 post(s)" };
const clean = { openTurns: 0, earlierTables: 0 };
const run = (
  mode: WorldCheckRun["mode"],
  checks: WorldCheckRun["results"][number]["checks"],
  extra: Partial<WorldCheckRun> = {},
): WorldCheckRun => ({
  mode,
  pass: 1,
  results: [{ repeat: 1, checks, invalid: null }],
  afterReset: clean,
  ...extra,
});
const both = { modes: ["noop", "reference"] as const, hasScript: true };

describe("world check verdict", () => {
  it("accepts an unjudged journey with checks, and nothing else as a valid run", () => {
    const finishedAt = new Date();
    expect(
      resultInvalid({
        status: "ERROR",
        error: "The judge was unavailable, so the journey is unscored",
        finishedAt,
        checks: [pass],
      }),
    ).toBeNull();
    expect(
      resultInvalid({
        status: "ERROR",
        error: "boom",
        finishedAt,
        checks: [pass],
      }),
    ).toMatch(/run error/);
    expect(
      resultInvalid({ status: "FAILED", error: null, finishedAt, checks: [] }),
    ).toMatch(/no checks/);
    expect(
      resultInvalid({
        status: "RUNNING",
        error: null,
        finishedAt: null,
        checks: [pass],
      }),
    ).toMatch(/did not finish/);
  });

  it("is clean when do-nothing fails, the reference passes and the lane was clean", () => {
    expect(
      journeyProblems([run("noop", [fail]), run("reference", [pass])], both),
    ).toEqual([]);
  });

  it("never reads an invalid, empty or missing run as a pass", () => {
    const invalid = run("reference", [], {
      results: [{ repeat: 1, checks: [], invalid: "no checks (FAILED)" }],
    });
    expect(journeyProblems([run("noop", [fail]), invalid], both)).toEqual([
      "reference pass 1 r1: INVALID RUN, no checks (FAILED)",
    ]);
    expect(
      journeyProblems(
        [run("noop", [fail]), run("reference", [], { results: [] })],
        both,
      ),
    ).toEqual(["reference pass 1: INVALID RUN, the run made no result"]);
    expect(journeyProblems([run("noop", [fail])], both)).toEqual([
      "reference: INVALID RUN, never ran",
    ]);
  });

  it("reports a missing script as uncovered", () => {
    expect(
      journeyProblems([run("noop", [fail]), run("reference", [pass])], {
        ...both,
        hasScript: false,
      }),
    ).toContain("reference: UNCOVERED (no script)");
  });

  it("judges every repeat, and flags loose checks, failing references and leftovers", () => {
    const repeats = run("noop", [fail], {
      results: [
        { repeat: 1, checks: [fail], invalid: null },
        { repeat: 2, checks: [pass], invalid: null },
      ],
      afterReset: { openTurns: 0, earlierTables: 1 },
    });
    expect(journeyProblems([repeats, run("reference", [fail])], both)).toEqual([
      "noop pass 1 r2: do-nothing PASSES (checks too loose)",
      'noop pass 1: left over after the reset {"openTurns":0,"earlierTables":1}',
      "reference pass 1 r1: reference FAILS: 1. Posts => 0 post(s)",
      "noop: passes give different checks",
    ]);
  });

  it("flags a pass whose lane was never checked", () => {
    expect(
      journeyProblems([run("noop", [fail], { afterReset: null })], {
        modes: ["noop"],
        hasScript: false,
      }),
    ).toEqual([
      "noop pass 1: no agent step, so the lane after the reset was not checked",
    ]);
  });
});
