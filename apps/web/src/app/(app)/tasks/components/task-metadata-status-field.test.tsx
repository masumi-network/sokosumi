import { TaskStatus } from "@sokosumi/core-client";
import { act, render, screen } from "@testing-library/react";
import { startTransition } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  TaskDetailStatusProvider,
  useOptimisticTaskStatus,
} from "./task-detail-optimistic";
import {
  TaskMetadataStatusField,
  type TaskMetadataStatusFieldLabels,
} from "./task-metadata-status-field";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/components/modals/global-modals-context", () => ({
  useGlobalModalsContext: () => ({ showCalendarClientUpgradeModal: vi.fn() }),
}));
vi.mock("@/lib/actions/task/action", () => ({
  setTaskStatusFromDrag: vi.fn(),
}));

const statusLabels = Object.fromEntries(
  Object.values(TaskStatus).map((status) => [status, status]),
) as Record<TaskStatus, string>;
const labels = {
  status: "Status",
  statusLabels,
} as TaskMetadataStatusFieldLabels;

let finishWrite: () => void = () => {};

/** Stands in for the header menu: cancels the Task inside a transition. */
function Menu() {
  const [, showStatus] = useOptimisticTaskStatus(TaskStatus.QUEUED);
  return (
    <button
      type="button"
      onClick={() =>
        startTransition(async () => {
          showStatus(TaskStatus.CANCELED);
          await new Promise<void>((resolve) => (finishWrite = resolve));
        })
      }
    >
      menu cancel
    </button>
  );
}

describe("TaskMetadataStatusField", () => {
  it("shows a menu change and takes no pick until that write ends", async () => {
    render(
      <TaskDetailStatusProvider status={TaskStatus.QUEUED}>
        <Menu />
        <TaskMetadataStatusField
          taskId="task-1"
          status={TaskStatus.QUEUED}
          selectableStatuses={[TaskStatus.QUEUED, TaskStatus.READY]}
          labels={labels}
        />
      </TaskDetailStatusProvider>,
    );

    await act(async () =>
      screen.getByRole("button", { name: "menu cancel" }).click(),
    );

    expect(
      screen.getByRole("combobox", { name: "Status: CANCELED" }),
    ).toBeDisabled();

    await act(async () => finishWrite());

    expect(
      screen.getByRole("combobox", { name: "Status: QUEUED" }),
    ).toBeEnabled();
  });
});
