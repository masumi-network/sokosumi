import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatDaySeparator } from "@/app/chat/utils/date-utils";

describe("formatDaySeparator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Thursday, Nov 12 2026, local noon.
    vi.setSystemTime(new Date(2026, 10, 12, 12));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["en", new Date(2026, 10, 12, 9), "Today"],
    ["en", new Date(2026, 10, 11, 23), "Yesterday"],
    ["en", new Date(2026, 10, 9, 8), "Monday"],
    ["en", new Date(2026, 10, 2, 8), "Nov 2, 2026"],
    ["de", new Date(2026, 10, 12, 9), "Heute"],
    ["de", new Date(2026, 10, 2, 8), "02.11.2026"],
    ["es", new Date(2026, 10, 9, 8), "Lunes"],
  ])("labels in %s: %s -> %s", (locale, date, label) => {
    expect(formatDaySeparator(date, locale)).toBe(label);
  });
});
