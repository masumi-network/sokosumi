import { render, screen } from "@testing-library/react";
import { Activity, StrictMode, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

function createHarness(
  hook: typeof import("./use-task-title-heading-focus").useTaskTitleHeadingFocus,
) {
  return function HeadingHarness({
    taskId,
    headingKey = "a",
  }: {
    taskId: string;
    headingKey?: string;
  }) {
    const heading = useRef<HTMLHeadingElement>(null);
    hook(heading, taskId);
    return (
      <div>
        <h1 key={headingKey} ref={heading} tabIndex={-1}>
          Title {taskId}
        </h1>
        <input aria-label="Comment" />
      </div>
    );
  };
}

describe("useTaskTitleHeadingFocus", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("focuses the heading with preventScroll on mount and taskId change, skipping same-task rerenders and active form controls", async () => {
    vi.resetModules();
    const { useTaskTitleHeadingFocus } = await import(
      "./use-task-title-heading-focus"
    );
    const HeadingHarness = createHarness(useTaskTitleHeadingFocus);
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");

    const { rerender, unmount } = render(<HeadingHarness taskId="task-1" />);
    const heading = screen.getByRole("heading", { name: "Title task-1" });
    expect(heading).toHaveFocus();
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
    expect(focusSpy).toHaveBeenCalledTimes(1);

    // Same taskId, even with a remounted heading element, does not re-focus.
    heading.blur();
    rerender(<HeadingHarness taskId="task-1" headingKey="b" />);
    expect(focusSpy).toHaveBeenCalledTimes(1);

    // Active form control keeps focus even when taskId changes.
    const input = screen.getByLabelText("Comment");
    input.focus();
    focusSpy.mockClear();
    rerender(<HeadingHarness taskId="task-2" headingKey="b" />);
    expect(input).toHaveFocus();
    expect(focusSpy).not.toHaveBeenCalled();

    // Moving focus back to body lets the next taskId change focus the heading.
    input.blur();
    rerender(<HeadingHarness taskId="task-3" headingKey="b" />);
    expect(screen.getByRole("heading", { name: "Title task-3" })).toHaveFocus();
    expect(focusSpy).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });

    unmount();
  });

  it("skips the first heading on a fresh task page load, then focuses on subsequent task changes", async () => {
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([
      { name: "https://app.test/tasks/task-1" } as PerformanceEntry,
    ]);
    vi.resetModules();
    const { useTaskTitleHeadingFocus } = await import(
      "./use-task-title-heading-focus"
    );
    const HeadingHarness = createHarness(useTaskTitleHeadingFocus);

    const { rerender, unmount } = render(<HeadingHarness taskId="task-1" />);
    expect(
      screen.getByRole("heading", { name: "Title task-1" }),
    ).not.toHaveFocus();

    rerender(<HeadingHarness taskId="task-2" />);
    expect(screen.getByRole("heading", { name: "Title task-2" })).toHaveFocus();

    unmount();
  });

  it("matches StrictMode replay and Activity hide/reveal focus counts", async () => {
    vi.resetModules();
    const { useTaskTitleHeadingFocus } = await import(
      "./use-task-title-heading-focus"
    );
    const HeadingHarness = createHarness(useTaskTitleHeadingFocus);
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");

    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <HeadingHarness taskId="task-1" />
        </Activity>
      </StrictMode>,
    );
    expect(screen.getByRole("heading", { name: "Title task-1" })).toHaveFocus();
    expect(focusSpy).toHaveBeenCalledTimes(2);

    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <HeadingHarness taskId="task-1" />
        </Activity>
      </StrictMode>,
    );
    expect(focusSpy).toHaveBeenCalledTimes(2);

    rerender(
      <StrictMode>
        <Activity mode="visible">
          <HeadingHarness taskId="task-1" />
        </Activity>
      </StrictMode>,
    );
    expect(screen.getByRole("heading", { name: "Title task-1" })).toHaveFocus();
    expect(focusSpy).toHaveBeenCalledTimes(4);

    unmount();
  });
});
