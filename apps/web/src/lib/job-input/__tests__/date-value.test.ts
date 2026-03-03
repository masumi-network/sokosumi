import { normalizeDateValidationBound } from "@/lib/job-input/date-value";

describe("normalizeDateValidationBound", () => {
  it("keeps YYYY-MM-DD values unchanged", () => {
    expect(normalizeDateValidationBound("2026-03-10")).toBe("2026-03-10");
  });

  it("normalizes datetime-local bounds to day precision", () => {
    expect(normalizeDateValidationBound("2026-03-10T01:30")).toBe(
      "2026-03-10",
    );
    expect(normalizeDateValidationBound("2026-03-10T23:59")).toBe(
      "2026-03-10",
    );
  });

  it("returns undefined for invalid values", () => {
    expect(normalizeDateValidationBound("not-a-date")).toBeUndefined();
  });
});
