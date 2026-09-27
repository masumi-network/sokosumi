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

describe("EditTaskPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads the shared task-edit payload and renders the view", async () => {
    const result = { kind: "edit", taskId: "task_1" };
    loadTaskEditMock.mockResolvedValue(result);

    const { default: EditTaskPage, metadata } = await import("./page");

    expect(metadata).toEqual({ title: "Edit Task" });

    render(
      await EditTaskPage({
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
