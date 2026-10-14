import { describe, expect, it } from "vitest";

import {
  enumLabel,
  humanizeEnum,
  meaningfulStatus,
  problemApproval,
} from "./campaign-details";

describe("humanizeEnum", () => {
  it.each([
    ["UNDER_REVIEW", "Under review"],
    ["GOOD", "Good"],
    ["target_cpa", "Target cpa"],
  ])("writes %s as %s", (value, text) => {
    expect(humanizeEnum(value)).toBe(text);
  });
});

describe("enumLabel", () => {
  const known = ["GOOD", "POOR"] as const;

  it("prefers the translated label of a known value", () => {
    expect(enumLabel("GOOD", known, (key) => `label ${key}`)).toBe(
      "label GOOD",
    );
  });

  it("humanizes a value it does not know", () => {
    expect(enumLabel("VERY_GOOD", known, (key) => `label ${key}`)).toBe(
      "Very good",
    );
  });
});

describe("problemApproval", () => {
  it.each([null, "APPROVED", "UNSPECIFIED", "UNKNOWN"])(
    "hides %s",
    (status) => {
      expect(problemApproval(status)).toBeNull();
    },
  );

  it.each(["DISAPPROVED", "UNDER_REVIEW", "APPROVED_LIMITED"])(
    "shows %s",
    (status) => {
      expect(problemApproval(status)).toBe(status);
    },
  );
});

describe("meaningfulStatus", () => {
  it("keeps a real status and drops a missing or empty one", () => {
    expect(meaningfulStatus("GOOD")).toBe("GOOD");
    expect(meaningfulStatus(null)).toBeNull();
    expect(meaningfulStatus("UNKNOWN")).toBeNull();
  });
});
