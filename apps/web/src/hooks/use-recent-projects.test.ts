import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  appendProjectVisit,
  recentProjectsStorageKey,
  recordProjectVisit,
  useRecentProjectIds,
} from "./use-recent-projects";

const userA = { userId: "user-a", organizationId: "org-1" };
const userB = { userId: "user-b", organizationId: "org-1" };
const userAOtherOrg = { userId: "user-a", organizationId: "org-2" };
const userAPersonal = { userId: "user-a", organizationId: null };

describe("appendProjectVisit", () => {
  it("puts the newest visit first", () => {
    expect(appendProjectVisit(["a", "b"], "c")).toEqual(["c", "a", "b"]);
  });

  it("moves a revisited project back to the front instead of repeating it", () => {
    expect(appendProjectVisit(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
  });

  it("drops the oldest visit past the cap", () => {
    expect(appendProjectVisit(["a", "b", "c"], "d", 3)).toEqual([
      "d",
      "a",
      "b",
    ]);
  });

  it("starts a log from an empty one", () => {
    expect(appendProjectVisit([], "a")).toEqual(["a"]);
  });
});

describe("recordProjectVisit", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("writes to the user and workspace key, not a shared log", () => {
    recordProjectVisit("project-1", userA);

    expect(
      JSON.parse(localStorage.getItem(recentProjectsStorageKey(userA)) ?? ""),
    ).toEqual(["project-1"]);
    expect(localStorage.getItem(recentProjectsStorageKey(userB))).toBeNull();
    expect(
      localStorage.getItem(recentProjectsStorageKey(userAOtherOrg)),
    ).toBeNull();
    expect(
      localStorage.getItem("sokosumi.sidebar.recent-projects.v1"),
    ).toBeNull();
  });

  it("keeps personal-workspace visits off the org log", () => {
    recordProjectVisit("personal-1", userAPersonal);
    recordProjectVisit("org-1", userA);

    expect(
      JSON.parse(
        localStorage.getItem(recentProjectsStorageKey(userAPersonal)) ?? "",
      ),
    ).toEqual(["personal-1"]);
    expect(
      JSON.parse(localStorage.getItem(recentProjectsStorageKey(userA)) ?? ""),
    ).toEqual(["org-1"]);
  });
});

describe("useRecentProjectIds", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("reads only the current user and workspace log", () => {
    recordProjectVisit("theirs", userB);
    recordProjectVisit("other-org", userAOtherOrg);
    recordProjectVisit("ours", userA);

    const { result } = renderHook(() => useRecentProjectIds(userA));

    expect(result.current).toEqual(["ours"]);
  });

  it("returns nothing until a workspace scope exists", () => {
    recordProjectVisit("ours", userA);

    const { result } = renderHook(() => useRecentProjectIds(null));

    expect(result.current).toEqual([]);
  });

  it("follows a visit recorded in this tab", () => {
    const { result } = renderHook(() => useRecentProjectIds(userA));

    act(() => {
      recordProjectVisit("project-1", userA);
    });

    expect(result.current).toEqual(["project-1"]);
  });

  it("follows a visit recorded in another tab for the same scope", () => {
    const { result } = renderHook(() => useRecentProjectIds(userA));
    const key = recentProjectsStorageKey(userA);

    act(() => {
      localStorage.setItem(key, JSON.stringify(["from-other-tab"]));
      window.dispatchEvent(new StorageEvent("storage", { key }));
    });

    expect(result.current).toEqual(["from-other-tab"]);
  });

  it("ignores another workspace's storage event", () => {
    const { result } = renderHook(() => useRecentProjectIds(userA));
    const otherKey = recentProjectsStorageKey(userAOtherOrg);

    act(() => {
      localStorage.setItem(otherKey, JSON.stringify(["other-org"]));
      window.dispatchEvent(new StorageEvent("storage", { key: otherKey }));
    });

    expect(result.current).toEqual([]);
  });
});
