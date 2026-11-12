import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  isTaskArchived,
  markTaskArchived,
} from "@/app/tasks/utils/archived-task-ids";

import { ArchivedTasksList } from "./archived-tasks-list";

const { restoreMock, pushMock, refreshMock, toastSuccessMock, toastErrorMock } =
  vi.hoisted(() => ({
    restoreMock: vi.fn(),
    pushMock: vi.fn(),
    refreshMock: vi.fn(),
    toastSuccessMock: vi.fn(),
    toastErrorMock: vi.fn(),
  }));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock("sonner", () => ({
  toast: { success: toastSuccessMock, error: toastErrorMock },
}));

vi.mock("@/lib/services/task.client", () => ({
  taskClientService: { restore: restoreMock },
}));

const tasks = [
  { id: "t1", identifier: "SOK-7", name: "Plan launch", status: "DRAFT" },
  { id: "t2", identifier: null, name: "Write recap", status: "COMPLETED" },
] as const;

describe("ArchivedTasksList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("restores a Task, drops its row and offers to open it", async () => {
    restoreMock.mockResolvedValue(undefined);
    // Archived earlier in this tab, so the board still hides it.
    markTaskArchived("t1");
    render(<ArchivedTasksList tasks={[...tasks]} />);

    fireEvent.click(screen.getAllByRole("button", { name: "restoreNamed" })[0]);

    await waitFor(() => expect(screen.queryByText("Plan launch")).toBeNull());
    expect(restoreMock).toHaveBeenCalledWith("t1");
    expect(isTaskArchived("t1")).toBe(false);
    expect(screen.getByText("Write recap")).toBeTruthy();
    expect(refreshMock).toHaveBeenCalled();

    const [, options] = toastSuccessMock.mock.calls[0];
    options.action.onClick();
    expect(pushMock).toHaveBeenCalledWith("/tasks/SOK-7-plan-launch");
  });

  it("keeps the row and says so when restore fails", async () => {
    restoreMock.mockRejectedValue(new Error("409"));
    render(<ArchivedTasksList tasks={[...tasks]} />);

    fireEvent.click(screen.getAllByRole("button", { name: "restoreNamed" })[1]);

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("restoreError"),
    );
    expect(screen.getByText("Write recap")).toBeTruthy();
  });

  it("explains the empty list", () => {
    render(<ArchivedTasksList tasks={[]} />);
    expect(screen.getByText("empty")).toBeTruthy();
  });
});
