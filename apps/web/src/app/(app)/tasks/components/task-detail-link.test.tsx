import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  TASK_HOVER_DWELL_MS,
  TaskDetailLink,
} from "@/app/tasks/components/task-detail-link";
import { TASKS_RETURN_PATH_SESSION_KEY } from "@/app/tasks/components/task-navigation";
import { approachElement } from "@/test/approach-element";

const routerPrefetchMock = vi.fn();
// The task's content, not only the route's shared App Shell (kind "auto").
const CONTENT_PREFETCH = { kind: "full" };

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    prefetch: routerPrefetchMock,
  }),
}));

describe("TaskDetailLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prefetches the task detail content on a resting hover and on focus", () => {
    vi.useFakeTimers();
    try {
      render(<TaskDetailLink href="/tasks/task-1">Open task</TaskDetailLink>);
      const link = screen.getByRole("link", { name: "Open task" });

      fireEvent.pointerEnter(link);
      vi.advanceTimersByTime(TASK_HOVER_DWELL_MS);
      fireEvent.focus(link);

      expect(link).toHaveAttribute("href", "/tasks/task-1");
      expect(routerPrefetchMock.mock.calls).toEqual([
        ["/tasks/task-1", CONTENT_PREFETCH],
        ["/tasks/task-1", CONTENT_PREFETCH],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  // A pointer crossing a list on its way elsewhere must not start a server
  // render for every row it passes.
  it("does not load the content for a pointer that only passes over", () => {
    vi.useFakeTimers();
    try {
      render(<TaskDetailLink href="/tasks/task-1">Open task</TaskDetailLink>);
      const link = screen.getByRole("link", { name: "Open task" });

      fireEvent.pointerEnter(link);
      vi.advanceTimersByTime(TASK_HOVER_DWELL_MS - 1);
      fireEvent.pointerLeave(link);
      vi.advanceTimersByTime(TASK_HOVER_DWELL_MS);

      expect(routerPrefetchMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  // A touch also starts every scroll gesture, so it loads only the shell.
  it("prefetches only the shell on touch", () => {
    render(<TaskDetailLink href="/tasks/task-1">Open task</TaskDetailLink>);

    fireEvent.touchStart(screen.getByRole("link", { name: "Open task" }));

    expect(routerPrefetchMock).toHaveBeenCalledExactlyOnceWith("/tasks/task-1");
  });

  // A predicted approach is weaker intent than a hover, so it prefetches only
  // the shell and never pays for a content render.
  it("prefetches only the shell when the reader heads for the link", async () => {
    render(<TaskDetailLink href="/tasks/task-1">Open task</TaskDetailLink>);

    await act(() =>
      approachElement(screen.getByRole("link", { name: "Open task" })),
    );

    expect(routerPrefetchMock).toHaveBeenCalledExactlyOnceWith("/tasks/task-1");
  });

  it("stores the current tasks URL when navigating from the tasks root", () => {
    window.history.replaceState({}, "", "/tasks?view=list");

    render(<TaskDetailLink href="/tasks/task-1">Open task</TaskDetailLink>);

    fireEvent.click(screen.getByRole("link", { name: "Open task" }));

    expect(window.sessionStorage.getItem(TASKS_RETURN_PATH_SESSION_KEY)).toBe(
      "/tasks?view=list",
    );
  });
});
