import { describe, expect, it } from "vitest";

import {
  countActiveFileFilters,
  EMPTY_FILE_FILTERS,
} from "@/lib/utils/file-search.client";

describe("countActiveFileFilters", () => {
  it("counts nothing when no dimension is set", () => {
    expect(countActiveFileFilters(EMPTY_FILE_FILTERS)).toBe(0);
  });

  it("does not count the tag match mode as a filter", () => {
    expect(
      countActiveFileFilters({ ...EMPTY_FILE_FILTERS, tagMatch: "all" }),
    ).toBe(0);
  });

  it("counts every selected value across dimensions", () => {
    expect(
      countActiveFileFilters({
        ...EMPTY_FILE_FILTERS,
        categoryLabelIds: ["c1"],
        tagLabelIds: ["t1", "t2"],
        sourceKinds: ["DRIVE_UPLOAD"],
      }),
    ).toBe(4);
  });
});
