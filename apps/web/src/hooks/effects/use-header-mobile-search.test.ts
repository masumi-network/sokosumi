import { act, renderHook } from "@testing-library/react";
import type { MouseEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { pushMock, replaceMock, backMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  replaceMock: vi.fn(),
  backMock: vi.fn(),
}));

let mockPathname = "/chat";

vi.mock("@/app/components/history-search-dialog-provider", () => ({
  useOptionalHistorySearch: () => null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    replace: replaceMock,
    back: backMock,
  }),
  usePathname: () => mockPathname,
}));

vi.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => ({
    NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME: 300,
  }),
}));

import { useHeaderMobileSearch } from "./use-header-mobile-search";

const fakeClickEvent = {
  currentTarget: document.createElement("button"),
} as unknown as MouseEvent<HTMLButtonElement>;

describe("useHeaderMobileSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockPathname = "/chat";
    window.history.replaceState({}, "", "/chat");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes a typed query once /history commits and cancels when leaving /history", () => {
    const { result, rerender } = renderHook(() => useHeaderMobileSearch());

    act(() => {
      result.current.openSearch(fakeClickEvent);
    });
    expect(result.current.expanded).toBe(true);
    expect(pushMock).toHaveBeenCalledWith("/history");

    act(() => {
      result.current.handleInputChange("invoice");
    });

    mockPathname = "/history";
    window.history.replaceState({}, "", "/history");
    rerender();

    expect(replaceMock).toHaveBeenCalledWith("/history?q=invoice");

    act(() => {
      result.current.handleInputChange("later");
    });
    replaceMock.mockClear();

    mockPathname = "/chat";
    window.history.replaceState({}, "", "/chat");
    rerender();

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.expanded).toBe(false);
    expect(result.current.query).toBe("");
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("bounces back on /history arrival when dismissed before navigation committed", () => {
    const { result, rerender } = renderHook(() => useHeaderMobileSearch());

    act(() => {
      result.current.openSearch(fakeClickEvent);
      result.current.collapse();
    });
    expect(backMock).not.toHaveBeenCalled();

    mockPathname = "/history";
    window.history.replaceState({}, "", "/history");
    rerender();

    expect(backMock).toHaveBeenCalledTimes(1);
    expect(result.current.expanded).toBe(false);
  });
});
