import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { recentProjectsStorageKey } from "@/hooks/use-recent-projects";

import { useRecordProjectVisit } from "./use-record-project-visit";

const scope = { userId: "user-1", organizationId: "org-1" as string | null };

function readLog(target = scope): unknown {
  return JSON.parse(
    localStorage.getItem(recentProjectsStorageKey(target)) ?? "null",
  );
}

describe("useRecordProjectVisit", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("records a visit once the userId is known", () => {
    const { rerender } = renderHook(
      ({ userId }: { userId: string | undefined }) =>
        useRecordProjectVisit("project-1", userId, "org-1"),
      { initialProps: { userId: undefined as string | undefined } },
    );

    expect(localStorage.length).toBe(0);

    rerender({ userId: "user-1" });
    expect(readLog()).toEqual(["project-1"]);
  });

  it("moves newer project visits to the front and scopes by user and org", () => {
    renderHook(() => useRecordProjectVisit("project-1", "user-1", "org-1"));
    renderHook(() => useRecordProjectVisit("project-2", "user-1", "org-1"));
    renderHook(() => useRecordProjectVisit("project-3", "user-2", "org-1"));

    expect(readLog()).toEqual(["project-2", "project-1"]);
    expect(readLog({ userId: "user-2", organizationId: "org-1" })).toEqual([
      "project-3",
    ]);
  });
});
