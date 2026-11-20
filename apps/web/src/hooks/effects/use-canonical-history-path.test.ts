import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCanonicalHistoryPath } from "./use-canonical-history-path";

describe("useCanonicalHistoryPath", () => {
  let replaceStateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    replaceStateSpy = vi.spyOn(window.history, "replaceState");
  });

  afterEach(() => {
    replaceStateSpy.mockRestore();
    window.history.replaceState(null, "", "/");
  });

  it("replaces pathname while preserving history.state, search, and hash", () => {
    const state = { marker: "keep" };
    window.history.replaceState(state, "", "/tasks/SOK-12?tab=jobs#comment-3");
    replaceStateSpy.mockClear();

    renderHook(() => useCanonicalHistoryPath("/tasks/SOK-12-fix-login"));

    expect(replaceStateSpy).toHaveBeenCalledTimes(1);
    expect(replaceStateSpy).toHaveBeenCalledWith(
      state,
      "",
      "/tasks/SOK-12-fix-login?tab=jobs#comment-3",
    );
    expect(window.location.pathname).toBe("/tasks/SOK-12-fix-login");
    expect(window.location.search).toBe("?tab=jobs");
    expect(window.location.hash).toBe("#comment-3");
    expect(window.history.state).toEqual(state);
  });

  it("does nothing when targetPathname is null or already matches", () => {
    window.history.replaceState(null, "", "/tasks/SOK-12-fix-login");
    replaceStateSpy.mockClear();

    const { rerender } = renderHook(
      ({ target }: { target: string | null }) =>
        useCanonicalHistoryPath(target),
      { initialProps: { target: null as string | null } },
    );
    expect(replaceStateSpy).not.toHaveBeenCalled();

    rerender({ target: "/tasks/SOK-12-fix-login" });
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it("re-applies after a re-render if external code reverted window.location.pathname", () => {
    window.history.replaceState(null, "", "/tasks/SOK-12");
    replaceStateSpy.mockClear();

    const { rerender } = renderHook(
      ({ target }: { target: string | null }) =>
        useCanonicalHistoryPath(target),
      { initialProps: { target: "/tasks/SOK-12-fix-login" } },
    );
    expect(window.location.pathname).toBe("/tasks/SOK-12-fix-login");

    window.history.replaceState(window.history.state, "", "/tasks/SOK-12");
    rerender({ target: "/tasks/SOK-12-fix-login" });

    expect(window.location.pathname).toBe("/tasks/SOK-12-fix-login");
  });
});
