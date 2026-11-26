import { describe, expect, it } from "vitest";

import { headlineProblem, partPatchChecks } from "./eval-cmo-report-headline";

describe("headlineProblem", () => {
  it.each([
    // CMO.XYZ's own Cuso, 18 Nov 2026.
    [
      "Brand Brain corrections captured; strategy starting facts aligned",
      "two clauses joined by a semicolon",
    ],
    ["Strategy starting facts aligned with the Brand Brain", "internal terms"],
    [
      "I changed the LinkedIn posts in the calendar so that there is now only one LinkedIn post each week",
      "19 words",
    ],
    ["I fixed two things in your Brand Brain", null],
    ["LinkedIn is down to one post a week", null],
  ])("reads %s as %s", (headline, problem) => {
    expect(headlineProblem(headline)).toBe(problem);
  });
});

describe("partPatchChecks", () => {
  const save = (part?: string) => ({
    capability: "save_strategy",
    input: part ? { part } : {},
  });
  const passes = (
    calls: { capability: string; input: unknown }[],
    answer = "",
  ) => partPatchChecks(calls, answer).map((check) => check.pass);

  it("passes a change saved as a part patch", () => {
    expect(
      passes(
        [save("patch"), save("plan")],
        "LinkedIn is down to one post a week.",
      ),
    ).toEqual([true, true]);
  });

  it("fails a whole calendar, sent as part calendar or with no part", () => {
    expect(passes([save("calendar")])).toEqual([false, true]);
    expect(passes([save()])).toEqual([false, true]);
  });

  // NMKR's Cuso, 21 Nov 2026.
  it("fails an answer that asks the owner for the calendar", () => {
    expect(passes([], "Could you send me the full strategy calendar?")).toEqual(
      [true, false],
    );
  });
});
