import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadTaskEditMock = vi.fn();
const taskEditViewMock = vi.fn();

vi.mock("@/app/tasks/[taskId]/_lib/load-task-edit", () => ({
  loadTaskEdit: (...args: unknown[]) => loadTaskEditMock(...args),
  TaskEditView: (props: unknown) => {
    taskEditViewMock(props);
    return <div data-testid="task-edit-view" />;
  },
}));

describe("TaskEditModalPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads the shared task-edit payload and renders the view", async () => {
    const result = { kind: "edit", taskId: "task_1" };
    loadTaskEditMock.mockResolvedValue(result);

    const { default: TaskEditModalPage } = await import("./page");

    render(
      await TaskEditModalPage({
        params: Promise.resolve({
          taskId: "task_1",
        }),
      }),
    );

    expect(loadTaskEditMock).toHaveBeenCalledWith("task_1");
    expect(taskEditViewMock).toHaveBeenCalledWith({ result });
    expect(screen.getByTestId("task-edit-view")).toBeInTheDocument();
  });
});
