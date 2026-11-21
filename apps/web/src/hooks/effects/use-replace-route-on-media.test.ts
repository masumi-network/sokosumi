import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
  }),
}));

import { useReplaceRouteOnMedia } from "./use-replace-route-on-media";

function stubMatchMedia(initial: boolean) {
  const listeners = new Set<() => void>();
  const mql = {
    matches: initial,
    media: "(min-width: 768px)",
    addEventListener: vi.fn((_type: string, listener: () => void) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_type: string, listener: () => void) => {
      listeners.delete(listener);
    }),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    setMatches(next: boolean) {
      mql.matches = next;
      for (const listener of listeners) listener();
    },
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => mql),
  );
  return mql;
}

describe("useReplaceRouteOnMedia", () => {
  beforeEach(() => {
    replaceMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("replaces immediately when the media query already matches", () => {
    stubMatchMedia(true);
    renderHook(() => useReplaceRouteOnMedia("(min-width: 768px)", "/"));
    expect(replaceMock).toHaveBeenCalledExactlyOnceWith("/");
  });

  it("waits until the media query matches, replaces once, and unsubscribes on unmount", () => {
    const mql = stubMatchMedia(false);
    const { unmount } = renderHook(() =>
      useReplaceRouteOnMedia("(min-width: 768px)", "/"),
    );

    expect(replaceMock).not.toHaveBeenCalled();

    act(() => {
      mql.setMatches(true);
    });
    expect(replaceMock).toHaveBeenCalledExactlyOnceWith("/");

    act(() => {
      mql.setMatches(false);
      mql.setMatches(true);
    });
    expect(replaceMock).toHaveBeenCalledTimes(1);

    unmount();
    expect(mql.removeEventListener).toHaveBeenCalledTimes(1);
  });
});
