import { describe, expect, it } from "vitest";

import { normalizeTaskNameForCoreApi } from "@/lib/utils/task-transformer";

describe("normalizeTaskNameForCoreApi", () => {
  it("returns names without surrounding whitespace unchanged", () => {
    expect(normalizeTaskNameForCoreApi("Review onboarding flow")).toBe(
      "Review onboarding flow",
    );
  });

  it("trims surrounding whitespace before returning the name", () => {
    expect(normalizeTaskNameForCoreApi("  Review onboarding flow  ")).toBe(
      "Review onboarding flow",
    );
  });

  it("preserves long names after trimming whitespace", () => {
    const longName = "a".repeat(200);

    expect(normalizeTaskNameForCoreApi(`  ${longName}  `)).toBe(longName);
  });
});
