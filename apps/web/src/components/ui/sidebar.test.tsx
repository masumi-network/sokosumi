import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SidebarContent } from "@/components/ui/sidebar";

describe("SidebarContent scrollbar", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks the list as scrolling until it has been still for a second", () => {
    vi.useFakeTimers();
    const onScroll = vi.fn();
    const { container } = render(<SidebarContent onScroll={onScroll} />);
    const scroller = container.firstElementChild as HTMLElement;

    expect(scroller).not.toHaveAttribute("data-scrolling");

    fireEvent.scroll(scroller);
    expect(scroller).toHaveAttribute("data-scrolling");
    expect(onScroll).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(900);
    fireEvent.scroll(scroller);
    vi.advanceTimersByTime(900);
    expect(scroller).toHaveAttribute("data-scrolling");

    vi.advanceTimersByTime(100);
    expect(scroller).not.toHaveAttribute("data-scrolling");
  });
});
