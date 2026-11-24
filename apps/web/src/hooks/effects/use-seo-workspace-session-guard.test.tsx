import { render } from "@testing-library/react";
import { Activity, type RefObject, StrictMode, useLayoutEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dismissToast = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({
  toast: {
    dismiss: dismissToast,
  },
}));

import { useSeoWorkspaceSessionGuard } from "./use-seo-workspace-session-guard";

function createTrackedRef<T>(initial: T): {
  ref: RefObject<T>;
  writes: T[];
} {
  let value = initial;
  const writes: T[] = [];
  const ref: RefObject<T> = {
    get current() {
      return value;
    },
    set current(next: T) {
      value = next;
      writes.push(next);
    },
  };
  return { ref, writes };
}

describe("useSeoWorkspaceSessionGuard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes sessionKey in passive effect phase and retires key plus unconfirmed toast on unmount", async () => {
    const activeSessionKey: RefObject<string | null> = { current: null };
    const unconfirmed: RefObject<{ toastId: string } | null> = {
      current: { toastId: "toast-1" },
    };
    const siblingLayoutSetup: Array<string | null> = [];
    const siblingLayoutCleanup: Array<string | null> = [];

    function Probe({ sessionKey }: { sessionKey: string }) {
      useSeoWorkspaceSessionGuard(sessionKey, activeSessionKey, unconfirmed);
      useLayoutEffect(() => {
        siblingLayoutSetup.push(activeSessionKey.current);
        return () => {
          siblingLayoutCleanup.push(activeSessionKey.current);
        };
      }, []);
      return null;
    }

    const { unmount } = render(<Probe sessionKey="session-a" />);
    // Passive effect runs after layout effects.
    expect(siblingLayoutSetup).toEqual([null]);
    expect(activeSessionKey.current).toBe("session-a");

    const onAfterResolve = vi.fn();
    let resolveRequest!: () => void;
    const pendingRequest = new Promise<void>((resolve) => {
      resolveRequest = resolve;
    }).then(() => {
      if (activeSessionKey.current === "session-a") {
        onAfterResolve();
      }
    });

    unmount();

    // Layout cleanup saw the key before passive cleanup cleared it.
    expect(siblingLayoutCleanup).toEqual(["session-a"]);
    expect(activeSessionKey.current).toBeNull();
    expect(unconfirmed.current).toBeNull();
    expect(dismissToast).toHaveBeenCalledTimes(1);
    expect(dismissToast).toHaveBeenCalledWith("toast-1");

    resolveRequest();
    await pendingRequest;
    expect(onAfterResolve).not.toHaveBeenCalled();
  });

  it("dismisses an unconfirmed toast when sessionKey changes, and does not re-run when sessionKey is unchanged", () => {
    const activeSessionKey = createTrackedRef<string | null>("session-a");
    const unconfirmed: RefObject<{ toastId: string } | null> = {
      current: null,
    };

    function Probe({
      sessionKey,
      tick: _tick,
    }: {
      sessionKey: string;
      tick?: number;
    }) {
      useSeoWorkspaceSessionGuard(
        sessionKey,
        activeSessionKey.ref,
        unconfirmed,
      );
      return null;
    }

    const { rerender, unmount } = render(
      <Probe sessionKey="session-a" tick={1} />,
    );
    expect(activeSessionKey.writes).toEqual(["session-a"]);

    unconfirmed.current = { toastId: "toast-keep" };
    rerender(<Probe sessionKey="session-a" tick={2} />);
    expect(activeSessionKey.writes).toEqual(["session-a"]);
    expect(unconfirmed.current).toEqual({ toastId: "toast-keep" });
    expect(dismissToast).not.toHaveBeenCalled();

    rerender(<Probe sessionKey="session-b" tick={3} />);
    expect(activeSessionKey.writes).toEqual(["session-a", null, "session-b"]);
    expect(unconfirmed.current).toBeNull();
    expect(dismissToast).toHaveBeenCalledTimes(1);
    expect(dismissToast).toHaveBeenCalledWith("toast-keep");

    // Unmounting with no unconfirmed toast does not call toast.dismiss again.
    unmount();
    expect(activeSessionKey.writes).toEqual([
      "session-a",
      null,
      "session-b",
      null,
    ]);
    expect(dismissToast).toHaveBeenCalledTimes(1);
  });

  it("retires on Activity hide, restores on reveal, and counts exact StrictMode writes", () => {
    const activeSessionKey = createTrackedRef<string | null>(null);
    const unconfirmed: RefObject<{ toastId: string } | null> = {
      current: null,
    };
    const siblingLayoutOnReveal: Array<string | null> = [];

    function Probe({ sessionKey }: { sessionKey: string }) {
      useSeoWorkspaceSessionGuard(
        sessionKey,
        activeSessionKey.ref,
        unconfirmed,
      );
      useLayoutEffect(() => {
        siblingLayoutOnReveal.push(activeSessionKey.ref.current);
      }, []);
      return null;
    }

    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <Probe sessionKey="session-a" />
        </Activity>
      </StrictMode>,
    );
    expect(activeSessionKey.writes).toEqual(["session-a", null, "session-a"]);
    expect(activeSessionKey.ref.current).toBe("session-a");
    expect(siblingLayoutOnReveal).toEqual([null, null]);

    unconfirmed.current = { toastId: "toast-hide" };
    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <Probe sessionKey="session-a" />
        </Activity>
      </StrictMode>,
    );
    expect(activeSessionKey.ref.current).toBeNull();
    expect(unconfirmed.current).toBeNull();
    expect(dismissToast).toHaveBeenCalledTimes(1);
    expect(dismissToast).toHaveBeenCalledWith("toast-hide");
    expect(activeSessionKey.writes).toEqual([
      "session-a",
      null,
      "session-a",
      null,
    ]);

    rerender(
      <StrictMode>
        <Activity mode="visible">
          <Probe sessionKey="session-a" />
        </Activity>
      </StrictMode>,
    );
    expect(activeSessionKey.ref.current).toBe("session-a");
    // Passive restore happens after sibling layout effects on Activity reveal.
    expect(siblingLayoutOnReveal).toEqual([null, null, null, null]);
    expect(activeSessionKey.writes).toEqual([
      "session-a",
      null,
      "session-a",
      null,
      "session-a",
      null,
      "session-a",
    ]);

    unmount();
    expect(activeSessionKey.writes).toEqual([
      "session-a",
      null,
      "session-a",
      null,
      "session-a",
      null,
      "session-a",
      null,
    ]);
  });
});
