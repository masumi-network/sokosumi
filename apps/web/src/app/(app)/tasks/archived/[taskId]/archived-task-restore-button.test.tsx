import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  isTaskArchived,
  markTaskArchived,
} from "@/app/tasks/utils/archived-task-ids";

import { ArchivedTaskRestoreButton } from "./archived-task-restore-button";

const { restoreMock, replaceMock, toastSuccessMock, toastErrorMock } =
  vi.hoisted(() => ({
    restoreMock: vi.fn(),
    replaceMock: vi.fn(),
    toastSuccessMock: vi.fn(),
    toastErrorMock: vi.fn(),
  }));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

vi.mock("sonner", () => ({
  toast: { success: toastSuccessMock, error: toastErrorMock },
}));

vi.mock("@/lib/services/task.client", () => ({
  taskClientService: { restore: restoreMock },
}));

const task = { id: "t1", identifier: "SOK-7", name: "Plan launch" };

describe("ArchivedTaskRestoreButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("restores the Task and opens it", async () => {
    restoreMock.mockResolvedValue(undefined);
    markTaskArchived("t1");
    render(<ArchivedTaskRestoreButton task={task} />);

    fireEvent.click(screen.getByRole("button", { name: "restore" }));

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith("/tasks/SOK-7-plan-launch"),
    );
    expect(restoreMock).toHaveBeenCalledWith("t1");
    expect(isTaskArchived("t1")).toBe(false);
    expect(toastSuccessMock).toHaveBeenCalledWith("restored");
  });

  it("stays on the archived Task and says so when restore fails", async () => {
    restoreMock.mockRejectedValue(new Error("409"));
    render(<ArchivedTaskRestoreButton task={task} />);

    fireEvent.click(screen.getByRole("button", { name: "restore" }));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("restoreError"),
    );
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
