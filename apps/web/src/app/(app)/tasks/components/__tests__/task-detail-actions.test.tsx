import { type MemberWithOrganization, TaskStatus } from "@sokosumi/database";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TaskDetailActions } from "@/app/tasks/components/task-detail-actions";
import { setTaskStatusFromDrag } from "@/lib/actions/task/action";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/actions/task/action", () => ({
  setTaskStatusFromDrag: vi.fn(),
  deleteTask: vi.fn(),
  moveTaskToWorkspace: vi.fn(),
}));

vi.mock("@/app/tasks/components/move-task-to-workspace-dialog", () => ({
  MoveTaskToWorkspaceDialog: () => null,
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

const actionsMenuLabel = "Actions";

const personalWorkspaceLabel = "Test User";

const sampleOrganizations = [
  { organization: { id: "org-2", name: "Other Org" } },
] as unknown as MemberWithOrganization[];

describe("TaskDetailActions", () => {
  it("shows loading state only on the clicked status action", async () => {
    const user = userEvent.setup();
    const deferred = createDeferred<{ taskId: string }>();
    const setTaskStatusFromDragMock = vi.mocked(setTaskStatusFromDrag);
    setTaskStatusFromDragMock.mockReturnValueOnce(deferred.promise);

    render(
      <TaskDetailActions
        taskId="task-1"
        status={TaskStatus.CANCELED}
        jobsCount={0}
        actionsMenuLabel={actionsMenuLabel}
        labels={labels}
        personalWorkspaceLabel={personalWorkspaceLabel}
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

  it("runs status actions from the mobile overflow menu", async () => {
    const user = userEvent.setup();
    const setTaskStatusFromDragMock = vi.mocked(setTaskStatusFromDrag);
    setTaskStatusFromDragMock.mockResolvedValueOnce({ taskId: "task-1" });

    render(
      <TaskDetailActions
        taskId="task-1"
        status={TaskStatus.CANCELED}
        jobsCount={0}
        actionsMenuLabel={actionsMenuLabel}
        labels={labels}
        personalWorkspaceLabel={personalWorkspaceLabel}
      />,
    );

    await user.click(screen.getByRole("button", { name: actionsMenuLabel }));

    await user.click(screen.getByRole("menuitem", { name: "Revert to Draft" }));

    await waitFor(() => {
      expect(setTaskStatusFromDragMock).toHaveBeenCalledWith({
        taskId: "task-1",
        desiredStatus: TaskStatus.DRAFT,
      });
    });
  });

  it("shows move to workspace when the task can be moved", () => {
    render(
      <TaskDetailActions
        taskId="task-1"
        status={TaskStatus.READY}
        jobsCount={0}
        actionsMenuLabel={actionsMenuLabel}
        labels={labels}
        organizations={sampleOrganizations}
        personalWorkspaceLabel={personalWorkspaceLabel}
      />,
    );

    expect(
      screen.getAllByRole("button", { name: "moveToWorkspace" }).length,
    ).toBeGreaterThan(0);
  });

  it("shows move for an organization task even when memberships are empty (personal is still a target)", () => {
    render(
      <TaskDetailActions
        taskId="task-1"
        status={TaskStatus.READY}
        jobsCount={0}
        actionsMenuLabel={actionsMenuLabel}
        labels={labels}
        currentOrganizationId="org-current"
        organizations={[]}
        personalWorkspaceLabel={personalWorkspaceLabel}
      />,
    );

    expect(
      screen.getAllByRole("button", { name: "moveToWorkspace" }).length,
    ).toBeGreaterThan(0);
  });

  it("hides move for a personal task when the user has no organizations", () => {
    render(
      <TaskDetailActions
        taskId="task-1"
        status={TaskStatus.READY}
        jobsCount={0}
        actionsMenuLabel={actionsMenuLabel}
        labels={labels}
        currentOrganizationId={null}
        organizations={[]}
        personalWorkspaceLabel={personalWorkspaceLabel}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "moveToWorkspace" }),
    ).not.toBeInTheDocument();
  });

  it("hides move to workspace when the task already has jobs", () => {
    render(
      <TaskDetailActions
        taskId="task-1"
        status={TaskStatus.READY}
        jobsCount={1}
        actionsMenuLabel={actionsMenuLabel}
        labels={labels}
        organizations={sampleOrganizations}
        personalWorkspaceLabel={personalWorkspaceLabel}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "moveToWorkspace" }),
    ).not.toBeInTheDocument();
  });
});
