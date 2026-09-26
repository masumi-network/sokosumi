import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  rememberPushPreference,
  resumePushPreferenceForSession,
  wantsPushHere,
} from "./push-preference.client";
import { healPushSubscription } from "./push-self-heal.client";
import {
  hasUnfinishedPushTeardown,
  notePushTeardownStarted,
} from "./release-push-device.client";
import { usePushRecovery } from "./use-push-recovery";

vi.mock("./push-self-heal.client", () => ({
  healPushSubscription: vi.fn(),
}));

const heal = vi.mocked(healPushSubscription);

async function dispatchWindowEvent(type: string): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new Event(type));
  });
}

describe("usePushRecovery", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(0);
    heal.mockReset();
    heal.mockResolvedValue(true);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("repairs on mount and throttles successful checks for one minute", async () => {
    renderHook(() => usePushRecovery("reader"));
    await act(async () => {});
    expect(heal).toHaveBeenCalledExactlyOnceWith("reader");

    await dispatchWindowEvent("focus");
    await dispatchWindowEvent("pageshow");
    await dispatchWindowEvent("online");
    expect(heal).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_000);
    await dispatchWindowEvent("focus");
    expect(heal).toHaveBeenCalledTimes(2);
  });

  it.each(["focus", "pageshow"])(
    "throttles failures briefly before retrying on %s",
    async (event) => {
      heal.mockResolvedValue(false);
      renderHook(() => usePushRecovery("reader"));
      await act(async () => {});

      await dispatchWindowEvent(event);
      expect(heal).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(5_000);
      await dispatchWindowEvent(event);
      expect(heal).toHaveBeenCalledTimes(2);
    },
  );

  it("retries a failed repair immediately when connectivity returns", async () => {
    heal.mockResolvedValue(false);
    renderHook(() => usePushRecovery("reader"));
    await act(async () => {});

    await dispatchWindowEvent("online");
    expect(heal).toHaveBeenCalledTimes(2);
  });

  it("retries once after a reconnect during a failed repair", async () => {
    let finish: (result: boolean) => void = () => {};
    heal.mockReturnValue(
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
    );
    renderHook(() => usePushRecovery("reader"));

    await dispatchWindowEvent("online");
    await dispatchWindowEvent("focus");
    expect(heal).toHaveBeenCalledTimes(1);

    await act(async () => finish(false));
    expect(heal).toHaveBeenCalledTimes(2);
  });

  it.each(["success", "unmount"])(
    "does not replay a pending reconnect after %s",
    async (outcome) => {
      let finish: (result: boolean) => void = () => {};
      heal.mockReturnValueOnce(
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
      );
      const { unmount } = renderHook(() => usePushRecovery("reader"));
      await dispatchWindowEvent("online");
      if (outcome === "unmount") unmount();
      await act(async () => finish(outcome === "success"));
      expect(heal).toHaveBeenCalledTimes(1);
    },
  );

  it("repairs only when a visibility change makes the document visible", async () => {
    heal.mockResolvedValue(false);
    renderHook(() => usePushRecovery("reader"));
    await act(async () => {});

    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(heal).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5_000);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(heal).toHaveBeenCalledTimes(2);
  });

  it("removes all event listeners on unmount", async () => {
    heal.mockResolvedValue(false);
    const { unmount } = renderHook(() => usePushRecovery("reader"));
    await act(async () => {});
    unmount();

    await dispatchWindowEvent("focus");
    await dispatchWindowEvent("pageshow");
    await dispatchWindowEvent("online");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(heal).toHaveBeenCalledTimes(1);
  });

  it("isolates a new reader from the previous reader's pending repair", async () => {
    let finishPrevious: (result: boolean) => void = () => {};
    heal.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        finishPrevious = resolve;
      }),
    );
    heal.mockResolvedValue(false);
    const { rerender } = renderHook(({ userId }) => usePushRecovery(userId), {
      initialProps: { userId: "previous" },
    });

    rerender({ userId: "current" });
    await act(async () => finishPrevious(true));
    await dispatchWindowEvent("online");

    expect(heal.mock.calls).toEqual([["previous"], ["current"], ["current"]]);
  });

  it("resumes consent and clears teardown before healing a newer authenticated session", async () => {
    resumePushPreferenceForSession("reader", "previous-session", 100);
    rememberPushPreference("reader", true);
    notePushTeardownStarted();
    const stateAtHeal = vi.fn();
    heal.mockImplementation(async () => {
      stateAtHeal(wantsPushHere("reader"), hasUnfinishedPushTeardown());
      return true;
    });

    renderHook(() => usePushRecovery("reader", "new-session", 200));
    await act(async () => {});
    expect(heal).toHaveBeenCalledExactlyOnceWith("reader");
    expect(stateAtHeal).toHaveBeenCalledExactlyOnceWith(true, false);
  });

  it.each([
    { userId: "reader", sessionId: "previous-session", createdAt: 100 },
    { userId: "reader", sessionId: "older-session", createdAt: 50 },
    { userId: "other", sessionId: "new-session", createdAt: 200 },
  ])(
    "preserves suspended consent and teardown for $sessionId belonging to $userId",
    async ({ userId, sessionId, createdAt }) => {
      resumePushPreferenceForSession("reader", "previous-session", 100);
      rememberPushPreference("reader", true);
      notePushTeardownStarted();
      const stateAtHeal = vi.fn();
      heal.mockImplementation(async () => {
        stateAtHeal(
          wantsPushHere("reader"),
          wantsPushHere("other"),
          hasUnfinishedPushTeardown(),
        );
        return false;
      });

      renderHook(() => usePushRecovery(userId, sessionId, createdAt));
      await act(async () => {});
      expect(heal).toHaveBeenCalledExactlyOnceWith(userId);
      expect(stateAtHeal).toHaveBeenCalledExactlyOnceWith(false, false, true);
    },
  );
});
