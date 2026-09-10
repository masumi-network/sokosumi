import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHAT_HEALTHY_REFRESH_MS,
  useChatRefreshScheduler,
} from "./use-chat-refresh-scheduler";

const FALLBACK_MS = 3_000;

let visibility: ReturnType<typeof vi.spyOn>;
let hasFocus: ReturnType<typeof vi.spyOn>;

function goBackground(kind: "hidden" | "blur") {
  if (kind === "hidden") {
    visibility.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
  } else {
    hasFocus.mockReturnValue(false);
    window.dispatchEvent(new Event("blur"));
  }
}

function goForeground() {
  visibility.mockReturnValue("visible");
  hasFocus.mockReturnValue(true);
  document.dispatchEvent(new Event("visibilitychange"));
  window.dispatchEvent(new Event("focus"));
}

function mount(
  refresh: (isCurrent: () => boolean) => Promise<void>,
  overrides: Partial<{
    key: string | null;
    healthy: boolean;
    refreshOnMount: boolean;
    refreshOnRecovery: boolean;
  }> = {},
) {
  return renderHook(
    (props: { key: string | null; healthy: boolean }) =>
      useChatRefreshScheduler({
        key: props.key,
        refresh,
        healthy: props.healthy,
        fallbackIntervalMs: FALLBACK_MS,
        refreshOnMount: overrides.refreshOnMount ?? false,
        refreshOnRecovery: overrides.refreshOnRecovery ?? false,
      }),
    {
      initialProps: {
        key: overrides.key === undefined ? "room-1" : overrides.key,
        healthy: overrides.healthy ?? true,
      },
    },
  );
}

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("useChatRefreshScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("visible");
    hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("recovers every 60 seconds while healthy, re-armed after each completion", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    mount(refresh);

    await tick(CHAT_HEALTHY_REFRESH_MS - 1);
    expect(refresh).not.toHaveBeenCalled();
    await tick(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    await tick(CHAT_HEALTHY_REFRESH_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("polls at the fallback cadence while unhealthy and slows down on recovery", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { rerender } = mount(refresh, { healthy: false });

    await tick(FALLBACK_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    await tick(FALLBACK_MS);
    expect(refresh).toHaveBeenCalledTimes(2);

    rerender({ key: "room-1", healthy: true });
    await tick(FALLBACK_MS * 2);
    expect(refresh).toHaveBeenCalledTimes(2);
    await tick(CHAT_HEALTHY_REFRESH_MS);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("starts no timer read while hidden and reads once on return", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    mount(refresh, { healthy: false });

    await act(async () => goBackground("hidden"));
    await tick(FALLBACK_MS * 4);
    expect(refresh).not.toHaveBeenCalled();

    await act(async () => goForeground());
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it.each(["hidden", "blur"] as const)(
    "runs an explicit request while %s, so the tab title can change while away",
    async (kind) => {
      const refresh = vi.fn().mockResolvedValue(undefined);
      const { result } = mount(refresh, { healthy: false });

      await act(async () => goBackground(kind));
      await act(async () => {
        result.current();
      });
      expect(refresh).toHaveBeenCalledTimes(1);

      // The read already happened; the return has nothing stale to catch up.
      await act(async () => goForeground());
      expect(refresh).toHaveBeenCalledTimes(1);
    },
  );

  it("runs a queued explicit request as soon as the in-flight read finishes, even while hidden", async () => {
    const pending = Promise.withResolvers<void>();
    const refresh = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(undefined);
    const { result } = mount(refresh);

    await act(async () => {
      result.current();
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    await act(async () => goBackground("hidden"));
    await act(async () => {
      result.current();
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    await act(async () => pending.resolve());
    expect(refresh).toHaveBeenCalledTimes(2);

    await act(async () => goForeground());
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("treats a visible but unfocused window as background", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    mount(refresh, { healthy: false });

    await act(async () => goBackground("blur"));
    await tick(FALLBACK_MS * 3);
    expect(refresh).not.toHaveBeenCalled();

    await act(async () => goForeground());
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the timer instead of reading when nothing went stale while away", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    mount(refresh);

    await act(async () => goBackground("hidden"));
    await tick(1_000);
    await act(async () => goForeground());
    expect(refresh).not.toHaveBeenCalled();
    await tick(CHAT_HEALTHY_REFRESH_MS - 1_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("reads once on return when a timer elapsed after an explicit read while away", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { result } = mount(refresh);

    await act(async () => goBackground("hidden"));
    await act(async () => {
      result.current();
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    await tick(CHAT_HEALTHY_REFRESH_MS);
    expect(refresh).toHaveBeenCalledTimes(1);

    await act(async () => goForeground());
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("does not treat the first healthy flip as a recovery", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { rerender } = mount(refresh, {
      healthy: false,
      refreshOnMount: true,
      refreshOnRecovery: true,
    });
    await act(async () => undefined);
    expect(refresh).toHaveBeenCalledTimes(1);

    rerender({ key: "room-1", healthy: true });
    await act(async () => undefined);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("reads once after a drop from healthy, if asked", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { rerender } = mount(refresh, {
      healthy: true,
      refreshOnRecovery: true,
    });
    await act(async () => undefined);
    expect(refresh).not.toHaveBeenCalled();

    rerender({ key: "room-1", healthy: false });
    await act(async () => undefined);
    expect(refresh).not.toHaveBeenCalled();

    rerender({ key: "room-1", healthy: true });
    await act(async () => undefined);
    expect(refresh).toHaveBeenCalledTimes(1);
    rerender({ key: "room-1", healthy: true });
    await act(async () => undefined);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("coalesces explicit requests during an in-flight read into one follow-up", async () => {
    const pending = Promise.withResolvers<void>();
    const refresh = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(undefined);
    const { result } = mount(refresh);

    await act(async () => {
      result.current();
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => {
      result.current();
      result.current();
      result.current();
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    await act(async () => pending.resolve());
    expect(refresh).toHaveBeenCalledTimes(2);
    await tick(CHAT_HEALTHY_REFRESH_MS - 1);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("keeps a need that arose while away and returns during an in-flight read", async () => {
    const pending = Promise.withResolvers<void>();
    const refresh = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(undefined);
    const { result } = mount(refresh);

    await act(async () => {
      result.current();
    });
    await act(async () => {
      goBackground("hidden");
      result.current();
      goForeground();
      window.dispatchEvent(new Event("online"));
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve());
    expect(refresh).toHaveBeenCalledTimes(2);
    await tick(CHAT_HEALTHY_REFRESH_MS - 1);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("does not stack a return with nothing stale onto an in-flight read", async () => {
    const pending = Promise.withResolvers<void>();
    const refresh = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(undefined);
    const { result } = mount(refresh);

    await act(async () => {
      result.current();
    });
    await act(async () => {
      goBackground("hidden");
      goForeground();
    });
    await act(async () => pending.resolve());
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("re-arms after a rejected read", async () => {
    const refresh = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    mount(refresh, { healthy: false });

    await tick(FALLBACK_MS * 2);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("refreshes on mount when asked and after a key change", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { rerender } = mount(refresh, { refreshOnMount: true });

    await act(async () => undefined);
    expect(refresh).toHaveBeenCalledTimes(1);
    rerender({ key: "room-2", healthy: true });
    await act(async () => undefined);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("marks the in-flight read stale on unmount and stops the timer", async () => {
    let seenCurrent: boolean | null = null;
    const pending = Promise.withResolvers<void>();
    const refresh = vi.fn(async (isCurrent: () => boolean) => {
      await pending.promise;
      seenCurrent = isCurrent();
    });
    const { result, unmount } = mount(refresh);

    await act(async () => {
      result.current();
    });
    unmount();
    await act(async () => pending.resolve());
    expect(seenCurrent).toBe(false);
    await tick(CHAT_HEALTHY_REFRESH_MS * 2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does nothing without a key", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { result } = mount(refresh, { key: null, refreshOnMount: true });

    await act(async () => {
      result.current();
    });
    await tick(CHAT_HEALTHY_REFRESH_MS);
    expect(refresh).not.toHaveBeenCalled();
  });
});
