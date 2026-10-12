import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadTaskEditMock = vi.fn();
const taskEditViewMock = vi.fn();
const projectScopeMarkerMock = vi.fn();

vi.mock("@/app/tasks/[taskId]/_lib/load-task-edit", () => ({
  loadTaskEdit: (...args: unknown[]) => loadTaskEditMock(...args),
  TaskEditView: (props: unknown) => {
    taskEditViewMock(props);
    return <div data-testid="task-edit-view" />;
  },
}));

vi.mock("@/app/components/project-scope/project-scope-marker", () => ({
  ProjectScopeMarker: (props: unknown) => {
    projectScopeMarkerMock(props);
    return null;
  },
}));

describe("EditTaskPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads the shared task-edit payload and renders the view", async () => {
    const result = {
      kind: "edit" as const,
      taskId: "task_1",
      initialValues: { projectId: "project_1" },
    };
    loadTaskEditMock.mockResolvedValue(result);

    const { default: EditTaskPage, metadata } = await import("./page");

    expect(metadata).toEqual({ title: "Edit task" });

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
    expect(projectScopeMarkerMock).toHaveBeenCalledWith({
      projectId: "project_1",
    });
  });

  it("marks a null project when the task has no project", async () => {
    const result = {
      kind: "edit" as const,
      taskId: "task_1",
      initialValues: { projectId: null },
    };
    loadTaskEditMock.mockResolvedValue(result);

    const { default: EditTaskPage } = await import("./page");

    render(
      await EditTaskPage({
        params: Promise.resolve({
          taskId: "task_1",
        }),
      }),
    );

    expect(projectScopeMarkerMock).toHaveBeenCalledWith({ projectId: null });
  });

  it("does not mark a project while switching workspace", async () => {
    const result = { kind: "switch-workspace" as const };
    loadTaskEditMock.mockResolvedValue(result);

    const { default: EditTaskPage } = await import("./page");

    render(
      await EditTaskPage({
        params: Promise.resolve({
          taskId: "task_1",
        }),
      }),
    );

    expect(taskEditViewMock).toHaveBeenCalledWith({ result });
    expect(projectScopeMarkerMock).not.toHaveBeenCalled();
  });
});
