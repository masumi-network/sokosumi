import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SIDEBAR_USER_WIDTH_VAR,
  serializeSidebarWidthCookie,
} from "@/lib/ui-preferences/sidebar-state";
import {
  applySidebarWidth,
  type UseSidebarEdgeRestoreOnOpenResult,
  useSidebarEdgeRestoreOnOpen,
} from "./use-sidebar-edge-restore-on-open";

describe("useSidebarEdgeRestoreOnOpen", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.style.removeProperty(SIDEBAR_USER_WIDTH_VAR);
    document.cookie = "sidebar_width=; max-age=0; path=/";
  });

  it("restores stored width immediately when reopened during slide-out window and after 250ms when kept closed", () => {
    vi.useFakeTimers();
    document.cookie = serializeSidebarWidthCookie(280);
    applySidebarWidth(140);

    const captured: { controls: UseSidebarEdgeRestoreOnOpenResult | null } = {
      controls: null,
    };

    function Probe({ open }: { open: boolean }) {
      captured.controls = useSidebarEdgeRestoreOnOpen(open);
      return null;
    }

    const { rerender, unmount } = render(<Probe open={false} />);

    act(() => {
      captured.controls?.restoreAfterSlideOut();
    });
    expect(captured.controls?.restoreTimer.current).not.toBeNull();
    expect(
      document.documentElement.style.getPropertyValue(SIDEBAR_USER_WIDTH_VAR),
    ).toBe("140px");

    // Reopening before the 250ms slide-out finishes cancels the timer and restores stored width immediately.
    rerender(<Probe open={true} />);
    expect(captured.controls?.restoreTimer.current).toBeNull();
    expect(
      document.documentElement.style.getPropertyValue(SIDEBAR_USER_WIDTH_VAR),
    ).toBe("280px");

    // When remaining closed, the 250ms timer restores stored width on expiry.
    rerender(<Probe open={false} />);
    applySidebarWidth(120);
    act(() => {
      captured.controls?.restoreAfterSlideOut();
      vi.advanceTimersByTime(250);
    });
    expect(
      document.documentElement.style.getPropertyValue(SIDEBAR_USER_WIDTH_VAR),
    ).toBe("280px");

    unmount();
  });
});
