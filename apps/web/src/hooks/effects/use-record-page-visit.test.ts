import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { readVisitCounts } from "@/lib/navigation/likely-pages";

import { useRecordPageVisit } from "./use-record-page-visit";

describe("useRecordPageVisit", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("records a visit on mount and on pathname change", () => {
    const { rerender } = renderHook(
      ({ pathname }) => useRecordPageVisit(pathname),
      { initialProps: { pathname: "/tasks" } },
    );

    expect(readVisitCounts()["/tasks"]).toBe(1);

    rerender({ pathname: "/tasks" });
    expect(readVisitCounts()["/tasks"]).toBe(1);

    rerender({ pathname: "/agents" });
    expect(readVisitCounts()["/agents"]).toBe(1);
  });
});
