import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useCalendarWeekRowLabel } from "./use-calendar-week-row-label";

describe("useCalendarWeekRowLabel", () => {
  it("sets aria-label on the week row when both row and label are present", () => {
    const row = document.createElement("tr");

    const { rerender } = renderHook(
      ({
        target,
        label,
      }: {
        target: HTMLElement | null;
        label: string | null;
      }) => useCalendarWeekRowLabel(target, label),
      {
        initialProps: {
          target: row as HTMLElement | null,
          label: null as string | null,
        },
      },
    );

    expect(row.getAttribute("aria-label")).toBeNull();

    rerender({ target: row, label: "Week 47" });
    expect(row.getAttribute("aria-label")).toBe("Week 47");

    rerender({ target: row, label: "Week 48" });
    expect(row.getAttribute("aria-label")).toBe("Week 48");
  });
});
