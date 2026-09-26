import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";

function SidebarProbe() {
  const { open, state, setOpen } = useSidebar();

  return (
    <button
      type="button"
      data-testid="sidebar-probe"
      data-open={String(open)}
      data-state={state}
      onClick={() => setOpen(true)}
    />
  );
}

const originalMatchMedia = window.matchMedia;

/** Drives `useIsSidebarCompact` without depending on happy-dom viewport internals. */
function mockCompactWindow(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<() => void>();

  window.matchMedia = vi.fn().mockImplementation((media: string) => ({
    get matches() {
      return matches;
    },
    media,
    onchange: null,
    addEventListener: (event: string, listener: () => void) => {
      if (event === "change") {
        listeners.add(listener);
      }
    },
    removeEventListener: (event: string, listener: () => void) => {
      if (event === "change") {
        listeners.delete(listener);
      }
    },
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as typeof window.matchMedia;

  return {
    setCompact(nextMatches: boolean) {
      matches = nextMatches;
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

function readCookiePreference() {
  return document.cookie.match(/sidebar_state=(true|false)/)?.[1] ?? null;
}

describe("SidebarProvider on a compact window", () => {
  beforeEach(() => {
    document.cookie =
      "sidebar_state=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("shows the rail below the compact breakpoint even when the cookie says expanded", async () => {
    document.cookie = "sidebar_state=true; path=/";
    mockCompactWindow(true);

    const { getByTestId } = render(
      <SidebarProvider defaultOpen>
        <SidebarProbe />
      </SidebarProvider>,
    );

    await waitFor(() => {
      expect(getByTestId("sidebar-probe")).toHaveAttribute(
        "data-state",
        "collapsed",
      );
    });
  });

  it("keeps the stored preference above the compact breakpoint", async () => {
    document.cookie = "sidebar_state=true; path=/";
    mockCompactWindow(false);

    const { getByTestId } = render(
      <SidebarProvider defaultOpen>
        <SidebarProbe />
      </SidebarProvider>,
    );

    await waitFor(() => {
      expect(getByTestId("sidebar-probe")).toHaveAttribute(
        "data-state",
        "expanded",
      );
    });
  });

  it("opens on request but does not write that to the cookie", async () => {
    document.cookie = "sidebar_state=false; path=/";
    mockCompactWindow(true);

    const { getByTestId } = render(
      <SidebarProvider defaultOpen>
        <SidebarProbe />
      </SidebarProvider>,
    );

    act(() => {
      getByTestId("sidebar-probe").click();
    });

    await waitFor(() => {
      expect(getByTestId("sidebar-probe")).toHaveAttribute(
        "data-state",
        "expanded",
      );
    });
    expect(readCookiePreference()).toBe("false");
  });

  it("returns to the rail the next time the window is narrow", async () => {
    const { setCompact } = mockCompactWindow(true);

    const { getByTestId } = render(
      <SidebarProvider defaultOpen>
        <SidebarProbe />
      </SidebarProvider>,
    );

    act(() => {
      getByTestId("sidebar-probe").click();
    });
    await waitFor(() => {
      expect(getByTestId("sidebar-probe")).toHaveAttribute(
        "data-state",
        "expanded",
      );
    });

    // Widen past the breakpoint and back: the stored preference takes over, and
    // the compact-only open is gone.
    act(() => {
      setCompact(false);
    });
    act(() => {
      setCompact(true);
    });

    await waitFor(() => {
      expect(getByTestId("sidebar-probe")).toHaveAttribute(
        "data-state",
        "collapsed",
      );
    });
  });
});
