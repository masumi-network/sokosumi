import "@testing-library/jest-dom";
import { TaskStatus } from "@sokosumi/database";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TaskDetailActions } from "@/app/tasks/components/task-detail-actions";
import { setTaskStatusFromDrag } from "@/lib/actions/task/action";

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
    refresh: jest.fn(),
  }),
}));

jest.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("@/lib/actions/task/action", () => ({
  setTaskStatusFromDrag: jest.fn(),
  deleteTask: jest.fn(),
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;

  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

const labels = {
  edit: "Edit",
  delete: "Delete",
  confirmDelete: "Confirm delete",
  confirmDeleteDescription: "Are you sure?",
  deleteError: "Delete error",
  markAsReady: "Mark as Ready",
  revertToDraft: "Revert to Draft",
  cancelRequest: "Cancel Request",
};

describe("TaskDetailActions", () => {
  it("shows loading state only on the clicked status action", async () => {
    const user = userEvent.setup();
    const deferred = createDeferred<{ taskId: string }>();
    const setTaskStatusFromDragMock = jest.mocked(setTaskStatusFromDrag);
    setTaskStatusFromDragMock.mockReturnValueOnce(deferred.promise);

    render(
      <TaskDetailActions
        taskId="task-1"
        status={TaskStatus.CANCELED}
        labels={labels}
      />,
    );

    const revertButton = screen.getByRole("button", {
      name: "Revert to Draft",
    });
    const markReadyButton = screen.getByRole("button", {
      name: "Mark as Ready",
    });

    await user.click(revertButton);

    await waitFor(() => {
      expect(revertButton).toBeDisabled();
      expect(markReadyButton).toBeDisabled();
    });

    expect(revertButton.querySelector(".animate-spin")).not.toBeNull();
    expect(markReadyButton.querySelector(".animate-spin")).toBeNull();

    deferred.resolve({ taskId: "task-1" });

    await waitFor(() => {
      expect(revertButton).not.toBeDisabled();
      expect(markReadyButton).not.toBeDisabled();
    });
  });
});
