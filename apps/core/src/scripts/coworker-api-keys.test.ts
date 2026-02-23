import { afterEach, describe, expect, it, vi } from "vitest";

import { parseExpiresAt } from "../../scripts/coworker-api-keys";

describe("coworker-api-keys.parseExpiresAt", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null when expires-at is not provided", () => {
    expect(parseExpiresAt(undefined)).toBeNull();
  });

  it("throws for invalid expires-at values", () => {
    expect(() => parseExpiresAt("invalid-date")).toThrow(
      "Invalid --expires-at value: invalid-date",
    );
  });

  it("throws when expires-at is not in the future", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    expect(() => parseExpiresAt("2026-01-01T00:00:00.000Z")).toThrow(
      "--expires-at must be a future ISO datetime",
    );
    expect(() => parseExpiresAt("2025-12-31T23:59:59.999Z")).toThrow(
      "--expires-at must be a future ISO datetime",
    );
  });

  it("accepts a future expires-at value", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const parsed = parseExpiresAt("2026-01-01T00:00:00.001Z");
    expect(parsed?.toISOString()).toBe("2026-01-01T00:00:00.001Z");
  });
});
