import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routerReplaceMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplaceMock }),
}));

import {
  forgetSavedTasksView,
  rememberSavedTasksView,
  useTasksRestoredViewUrl,
} from "./use-tasks-restored-view-url";

describe("useTasksRestoredViewUrl", () => {
  beforeEach(() => {
    routerReplaceMock.mockClear();
    window.history.replaceState(null, "", "/tasks");
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("replaces history state with null and merges restoredQuery into the address bar", () => {
    window.history.replaceState(
      { __NA: true },
      "",
      "/tasks?projectId=p-1#board",
    );

    renderHook(() =>
      useTasksRestoredViewUrl("scope=owned&status=READY", "org-restore-1"),
    );

    expect(window.location.search).toBe(
      "?projectId=p-1&scope=owned&status=READY",
    );
    expect(window.location.hash).toBe("#board");
    expect(window.history.state).toBeNull();
    expect(routerReplaceMock).not.toHaveBeenCalled();
  });

  it("navigates with router.replace when the tab saved a newer view than restoredQuery", () => {
    rememberSavedTasksView("org-restore-2", "scope=owned&sort=priority");

    renderHook(() =>
      useTasksRestoredViewUrl("scope=owned&status=READY", "org-restore-2"),
    );

    expect(routerReplaceMock).toHaveBeenCalledWith(
      "/tasks?scope=owned&sort=priority",
    );

    forgetSavedTasksView("org-restore-2", "scope=owned&sort=priority");
  });

  it("does nothing when the URL already carries task view params or restoredQuery is null", () => {
    window.history.replaceState(null, "", "/tasks?scope=all");

    renderHook(() =>
      useTasksRestoredViewUrl("scope=owned&status=READY", "org-restore-3"),
    );

    expect(window.location.search).toBe("?scope=all");
    expect(routerReplaceMock).not.toHaveBeenCalled();

    window.history.replaceState(null, "", "/tasks");
    renderHook(() => useTasksRestoredViewUrl(null, "org-restore-3"));
    expect(window.location.search).toBe("");
    expect(routerReplaceMock).not.toHaveBeenCalled();
  });
});
