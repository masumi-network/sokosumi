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
    vi.restoreAllMocks();
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  it("links to and navigates to the stored tasks return path", async () => {
    window.sessionStorage.setItem(
      TASKS_RETURN_PATH_SESSION_KEY,
      "/tasks?view=list",
    );

    render(<BackToTasksButton label="Back" />);

    const link = screen.getByRole("link", { name: "Back" });
    await waitFor(() => {
      expect(link.getAttribute("href")).toBe("/tasks?view=list");
    });

    fireEvent.click(link);

    expect(routerPushMock).toHaveBeenCalledWith("/tasks?view=list");
  });

  it("loads only the stored return path's content, not the placeholder", async () => {
    vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([
      new DOMRect(0, 0, 10, 10),
    ] as unknown as DOMRectList);
    window.sessionStorage.setItem(
      TASKS_RETURN_PATH_SESSION_KEY,
      "/tasks?view=list",
    );

    render(<BackToTasksButton label="Back" />);

    await waitFor(() => {
      expect(routerPrefetchMock).toHaveBeenCalled();
    });
    expect(routerPrefetchMock.mock.calls).toEqual([
      ["/tasks?view=list", expect.objectContaining({ kind: "full" })],
    ]);
  });

  it("loads nothing up front where the board is not the next page", async () => {
    vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([
      new DOMRect(0, 0, 10, 10),
    ] as unknown as DOMRectList);
    window.sessionStorage.setItem(
      TASKS_RETURN_PATH_SESSION_KEY,
      "/tasks?view=list",
    );

    render(<BackToTasksButton label="Back" loadOnMount={false} />);

    const link = screen.getByRole("link", { name: "Back" });
    await waitFor(() => {
      expect(link.getAttribute("href")).toBe("/tasks?view=list");
    });
    expect(routerPrefetchMock).not.toHaveBeenCalled();
  });

  it("leaves a modified click to the browser", () => {
    render(<BackToTasksButton label="Back" />);

    fireEvent.click(screen.getByRole("link", { name: "Back" }), {
      metaKey: true,
    });

    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it("reads the return path at click time, not from a lagging href", () => {
    render(<BackToTasksButton label="Back" />);
    window.sessionStorage.setItem(
      TASKS_RETURN_PATH_SESSION_KEY,
      "/tasks?view=board&assignee=me",
    );

    fireEvent.click(screen.getByRole("link", { name: "Back" }));

    expect(routerPushMock).toHaveBeenCalledWith(
      "/tasks?view=board&assignee=me",
    );
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

      fireEvent.click(await screen.findByRole("link", { name }));

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

    fireEvent.click(await screen.findByRole("link", { name: "Back" }));

    expect(routerPushMock).toHaveBeenCalledWith("/tasks");
  });
});
