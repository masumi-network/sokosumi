import { describe, expect, it } from "vitest";
import { prepareInputValues, JobInputsFormSchemaType } from "@/lib/job-input";

describe("prepareInputValues", () => {
  it("keeps date and datetime-local strings and removes null/undefined entries", () => {
    const values = {
      startDate: "2026-01-19",
      startAt: "2026-02-01T10:00",
      dateRange: ["2026-01-19", "2026-02-01"],
      count: 2,
      optional: null,
      unset: undefined,
    } as unknown as JobInputsFormSchemaType;

    const result = prepareInputValues(values);
    expect(result).toEqual({
      startDate: "2026-01-19",
      startAt: "2026-02-01T10:00",
      dateRange: ["2026-01-19", "2026-02-01"],
      count: 2,
    });
  });
});
