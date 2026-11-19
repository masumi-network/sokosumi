import {
  type Task,
  type TaskListItem,
  TaskStatus,
} from "@sokosumi/core-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskSubtaskSection } from "./task-subtask-section";

const listTasks = vi.hoisted(() => vi.fn());

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/lib/services/task.service", () => ({
  taskService: { listTasks },
}));
vi.mock("./task-subtask-list", () => ({ TaskSubtaskList: () => null }));

const task = {
  id: "parent",
  status: TaskStatus.READY,
  ancestors: [],
  subtaskProgress: { completed: 0, total: 1 },
} as unknown as Task;

const child = {
  id: "child",
  identifier: null,
  name: "Child",
  status: TaskStatus.READY,
  dueOn: null,
  subtaskProgress: { completed: 0, total: 0 },
} as unknown as TaskListItem;

function renderSection(overrides: Partial<Task> = {}) {
  return TaskSubtaskSection({
    task: { ...task, ...overrides },
    hasAssignedSeatPromise: Promise.resolve(true),
    assigneeOptionsPromise: Promise.resolve([]),
  });
}

beforeEach(() => {
  listTasks.mockReset();
});

describe("TaskSubtaskSection", () => {
  it("renders nothing for a Task with no sub-tasks", async () => {
    listTasks.mockResolvedValue({ tasks: [] });

    expect(await renderSection()).toBeNull();
  });

  it("renders the checklist once the Task has a sub-task", async () => {
    listTasks.mockResolvedValue({ tasks: [child] });

    const section = await renderSection();

    expect(section?.props.initialRows).toEqual([
      expect.objectContaining({ id: "child", name: "Child" }),
    ]);
    expect(section?.props.canAdd).toBe(true);
  });

  it.each([TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELED])(
    "offers no new sub-task on a %s Task, like the Task menu",
    async (status) => {
      listTasks.mockResolvedValue({ tasks: [child] });

      const section = await renderSection({ status });

      expect(section?.props.canAdd).toBe(false);
    },
  );
});
