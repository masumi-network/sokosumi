import { describe, expect, it } from "vitest";

import { headlineProblem } from "./eval-cmo-report-headline";

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
