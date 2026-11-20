import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RotatingMessages } from "./rotating-messages";

describe("RotatingMessages", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fades out before advancing and cycles through messages", () => {
    render(
      <RotatingMessages
        messages={["First thought", "Second thought"]}
        intervalMs={2_000}
      />,
    );

    const span = screen.getByText("First thought");
    expect(span).toHaveClass("opacity-100");

    act(() => {
      vi.advanceTimersByTime(1_600);
    });
    expect(screen.getByText("First thought")).toHaveClass("opacity-0");

    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByText("Second thought")).toHaveClass("opacity-100");

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(screen.getByText("First thought")).toHaveClass("opacity-100");
  });

  it("renders nothing and schedules no timers when messages are empty", () => {
    const { container } = render(<RotatingMessages messages={[]} />);
    expect(container).toBeEmptyDOMElement();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears pending timers on unmount", () => {
    const { unmount } = render(
      <RotatingMessages messages={["One", "Two"]} intervalMs={2_000} />,
    );
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
