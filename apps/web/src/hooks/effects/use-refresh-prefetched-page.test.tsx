import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshPageMock = vi.fn<() => Promise<boolean>>();
const routerRefreshMock = vi.fn();

vi.mock("@/lib/actions/refresh-page-action", () => ({
  refreshPage: () => refreshPageMock(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefreshMock }),
}));

const LOADED_AT = Math.floor(performance.timeOrigin) + 1;

async function loadHookAt(now: number) {
  vi.setSystemTime(now);
  vi.resetModules();
  return await import("./use-refresh-prefetched-page");
}

describe("useRefreshPrefetchedPage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: LOADED_AT });
    refreshPageMock.mockReset();
    refreshPageMock.mockResolvedValue(true);
    routerRefreshMock.mockReset();
    window.history.replaceState(null, "", "/tasks");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("refreshes immediately when everyVisit is true and no control is in use", async () => {
    const { useRefreshPrefetchedPage } = await loadHookAt(LOADED_AT);
    renderHook(() => useRefreshPrefetchedPage(true));

    await act(async () => {
      await Promise.resolve();
    });

    expect(refreshPageMock).toHaveBeenCalledTimes(1);
    expect(routerRefreshMock).not.toHaveBeenCalled();
  });

  it("waits while a navigation link is focused and cancels the check on unmount", async () => {
    const { useRefreshPrefetchedPage, CONTROL_IN_USE_CHECK_MS } =
      await loadHookAt(LOADED_AT);

    const link = document.createElement("a");
    link.href = `${window.location.origin}/chat`;
    link.textContent = "Chat";
    document.body.appendChild(link);
    link.focus();

    const { unmount } = renderHook(() => useRefreshPrefetchedPage(true));
    expect(refreshPageMock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(CONTROL_IN_USE_CHECK_MS);
    });
    expect(refreshPageMock).not.toHaveBeenCalled();

    unmount();
    link.blur();
    link.remove();

    act(() => {
      vi.advanceTimersByTime(CONTROL_IN_USE_CHECK_MS * 20);
    });
    expect(refreshPageMock).not.toHaveBeenCalled();
  });

  it("falls back to router.refresh when refreshPage returns false", async () => {
    refreshPageMock.mockResolvedValue(false);
    const { useRefreshPrefetchedPage } = await loadHookAt(LOADED_AT);
    renderHook(() => useRefreshPrefetchedPage(true));

    await act(async () => {
      await Promise.resolve();
    });

    expect(refreshPageMock).toHaveBeenCalledTimes(1);
    expect(routerRefreshMock).toHaveBeenCalledTimes(1);
  });
});
