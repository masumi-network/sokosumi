import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BackToTasksButton } from "@/app/tasks/components/back-to-tasks-button";
import {
  TASKS_RETURN_PATH_SESSION_KEY,
  TASKS_RETURN_TASK_SESSION_KEY,
} from "@/app/tasks/components/task-navigation";

const routerPrefetchMock = vi.fn();
const routerPushMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks/task-1",
  useRouter: () => ({
    prefetch: routerPrefetchMock,
    push: routerPushMock,
  }),
}));

describe("BackToTasksButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  it("prefetches and navigates to the stored tasks return path", async () => {
    window.sessionStorage.setItem(
      TASKS_RETURN_PATH_SESSION_KEY,
      "/tasks?view=list",
    );

    render(<BackToTasksButton label="Back" />);

    await waitFor(() => {
      expect(routerPrefetchMock).toHaveBeenCalledWith("/tasks?view=list");
    });

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(routerPushMock).toHaveBeenCalledWith("/tasks?view=list");
  });

  it.each([
    {
      taskPath: "/tasks/task-1",
      name: "Back to calendar",
      href: "/calendar?date=2026-11-19&view=week",
    },
    // Opened later from a notification or link: not this Calendar's task.
    { taskPath: "/tasks/task-2", name: "Back to tasks", href: "/tasks" },
  ])(
    "names and follows the Calendar only for its own task ($taskPath)",
    async ({ taskPath, name, href }) => {
      window.sessionStorage.setItem(
        TASKS_RETURN_PATH_SESSION_KEY,
        "/calendar?date=2026-11-19&view=week",
      );
      window.sessionStorage.setItem(TASKS_RETURN_TASK_SESSION_KEY, taskPath);

      render(
        <BackToTasksButton
          label="Back to tasks"
          calendarLabel="Back to calendar"
        />,
      );

      fireEvent.click(await screen.findByRole("button", { name }));

      expect(routerPushMock).toHaveBeenCalledWith(href);
    },
  );

  it("keeps a page without a Calendar label on the board", async () => {
    window.sessionStorage.setItem(
      TASKS_RETURN_PATH_SESSION_KEY,
      "/calendar?view=week",
    );
    window.sessionStorage.setItem(
      TASKS_RETURN_TASK_SESSION_KEY,
      "/tasks/task-1",
    );

    render(<BackToTasksButton label="Back" />);

    fireEvent.click(await screen.findByRole("button", { name: "Back" }));

    expect(routerPushMock).toHaveBeenCalledWith("/tasks");
  });
});
