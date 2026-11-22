import { render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serializeSidebarWidthCookie } from "@/lib/ui-preferences/sidebar-state";
import { useSidebarEdgeWidthLifecycle } from "./use-sidebar-edge-width-lifecycle";

describe("useSidebarEdgeWidthLifecycle", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.cookie = "sidebar_width=; max-age=0; path=/";
  });

  it("hydrates width from cookie on mount and clears pending timer and data-resizing on unmount", () => {
    vi.useFakeTimers();
    document.cookie = serializeSidebarWidthCookie(312);

    const timerFired = vi.fn();
    const restoreTimer: {
      current: ReturnType<typeof setTimeout> | number | null;
    } = {
      current: setTimeout(timerFired, 250),
    };
    const captured = { width: -1 };

    function Probe() {
      const ref = useRef<HTMLDivElement>(null);
      const { width } = useSidebarEdgeWidthLifecycle(ref, restoreTimer);
      captured.width = width;
      return (
        <div data-slot="sidebar-wrapper" data-resizing="true">
          <div ref={ref} />
        </div>
      );
    }

    const { container, unmount } = render(<Probe />);
    expect(captured.width).toBe(312);

    const wrapper = container.querySelector('[data-slot="sidebar-wrapper"]');
    expect(wrapper?.getAttribute("data-resizing")).toBe("true");

    unmount();
    expect(wrapper?.hasAttribute("data-resizing")).toBe(false);

    vi.advanceTimersByTime(300);
    expect(timerFired).not.toHaveBeenCalled();
  });
});
