import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useNotificationTimeFormatter } from "@/lib/utils/notification-time";

const NOW = new Date("2026-09-11T12:00:00.000Z");

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useNow: () => NOW,
  useFormatter: () => ({
    relativeTime: () => "relative",
    dateTime: () => "date",
  }),
}));

describe("useNotificationTimeFormatter", () => {
  it("says just now under a minute", () => {
    const { result } = renderHook(() => useNotificationTimeFormatter());

    expect(result.current(new Date(NOW.getTime() - 33_000))).toBe("justNow");
  });

  it("goes relative from a minute up to a week", () => {
    const { result } = renderHook(() => useNotificationTimeFormatter());

    expect(result.current(new Date(NOW.getTime() - 60_000))).toBe("relative");
    expect(result.current(new Date(NOW.getTime() - 6 * 86_400_000))).toBe(
      "relative",
    );
  });

  it("shows a date from a week on", () => {
    const { result } = renderHook(() => useNotificationTimeFormatter());

    expect(result.current(new Date(NOW.getTime() - 7 * 86_400_000))).toBe(
      "date",
    );
  });
});
