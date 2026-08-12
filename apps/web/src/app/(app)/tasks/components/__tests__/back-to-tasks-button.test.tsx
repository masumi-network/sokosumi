import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BackToTasksButton } from "@/app/tasks/components/back-to-tasks-button";
import { TASKS_RETURN_PATH_SESSION_KEY } from "@/app/tasks/components/task-navigation";

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
});
