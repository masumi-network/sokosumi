import { CHAT_PRESENCE_ONLINE_WINDOW_MS } from "@sokosumi/utils";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSelfPresence } from "@/hooks/use-self-presence";

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value,
  });
}

function setDocumentHidden(value: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value,
  });
}

/** Jump past idle and poke the hook's `online` listener to re-resolve. */
function advancePastOnlineWindow() {
  vi.setSystemTime(Date.now() + CHAT_PRESENCE_ONLINE_WINDOW_MS + 1);
  window.dispatchEvent(new Event("online"));
}

describe("useSelfPresence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T12:00:00.000Z"));
    setNavigatorOnline(true);
    setDocumentHidden(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    setNavigatorOnline(true);
    setDocumentHidden(false);
  });

  it("reports offline when the browser is offline", () => {
    setNavigatorOnline(false);

    const { result } = renderHook(() => useSelfPresence());

    expect(result.current).toBe("offline");
  });

  it("reports afk when the document is hidden", () => {
    const { result } = renderHook(() => useSelfPresence());

    expect(result.current).toBe("online");

    act(() => {
      setDocumentHidden(true);
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(result.current).toBe("afk");
  });

  it("reports afk after the shared online idle window with no activity", () => {
    const { result } = renderHook(() => useSelfPresence());

    expect(result.current).toBe("online");

    act(() => {
      advancePastOnlineWindow();
    });

    expect(result.current).toBe("afk");
  });

  it("returns to online on activity within the idle window", () => {
    const { result } = renderHook(() => useSelfPresence());

    act(() => {
      advancePastOnlineWindow();
    });
    expect(result.current).toBe("afk");

    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });

    expect(result.current).toBe("online");
  });
});
