import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TaskDetailLink } from "@/app/tasks/components/task-detail-link";
import { TASKS_RETURN_PATH_SESSION_KEY } from "@/app/tasks/components/task-navigation";

const routerPrefetchMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    prefetch: routerPrefetchMock,
  }),
}));

describe("TaskDetailLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prefetches the task detail route on hover, focus, and touch", () => {
    render(<TaskDetailLink href="/tasks/task-1">Open task</TaskDetailLink>);

    const link = screen.getByRole("link", { name: "Open task" });

    fireEvent.pointerEnter(link);
    fireEvent.focus(link);
    fireEvent.touchStart(link);

    expect(link).toHaveAttribute("href", "/tasks/task-1");
    expect(routerPrefetchMock).toHaveBeenCalledTimes(3);
    expect(routerPrefetchMock).toHaveBeenNthCalledWith(1, "/tasks/task-1");
    expect(routerPrefetchMock).toHaveBeenNthCalledWith(2, "/tasks/task-1");
    expect(routerPrefetchMock).toHaveBeenNthCalledWith(3, "/tasks/task-1");
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
