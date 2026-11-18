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
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useNow: () => new Date(),
}));
vi.mock("@/components/time-ago", () => ({
  TimeAgo: ({ date }: { date: string }) => <time>{date}</time>,
}));

const statusLabels = Object.fromEntries(
  Object.values(TaskStatus).map((status) => [status, status]),
) as Record<TaskStatus, string>;
const labels = {
  status: "Status",
  statusLabels,
} as TaskMetadataStatusFieldLabels;

let finishWrite: () => void = () => {};

/** Stands in for the header menu: moves the Task inside a transition. */
function Menu({
  from = TaskStatus.QUEUED,
  to = TaskStatus.CANCELED,
}: {
  from?: TaskStatus;
  to?: TaskStatus;
}) {
  const [, showStatus] = useOptimisticTaskStatus(from);
  return (
    <button
      type="button"
      onClick={() =>
        startTransition(async () => {
          showStatus(to);
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
          agentAssigneeName={null}
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

  it("shows time in status and restarts it when the status changes", async () => {
    const old = "2026-01-01T00:00:00.000Z";
    render(
      <TaskDetailStatusProvider status={TaskStatus.READY}>
        <Menu from={TaskStatus.READY} to={TaskStatus.INPUT_REQUIRED} />
        <TaskMetadataStatusField
          taskId="task-1"
          status={TaskStatus.READY}
          selectableStatuses={[TaskStatus.READY]}
          statusSince={old}
          agentAssigneeName={null}
          labels={labels}
        />
      </TaskDetailStatusProvider>,
    );

    expect(screen.getByText("stuck")).toBeVisible();
    expect(screen.getByText(old)).toBeTruthy();

    await act(async () =>
      screen.getByRole("button", { name: "menu cancel" }).click(),
    );

    expect(screen.queryByText("stuck")).toBeNull();
    expect(screen.getByText("label")).toBeVisible();
    expect(screen.queryByText(old)).toBeNull();

    await act(async () => finishWrite());

    expect(screen.getByText(old)).toBeTruthy();
  });
});
