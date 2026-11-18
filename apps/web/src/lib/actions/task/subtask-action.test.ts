import { TaskStatus } from "@sokosumi/core-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createTask, moveSubtask, revalidatePath } = vi.hoisted(() => ({
  createTask: vi.fn(),
  moveSubtask: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    <TParams, TResult>(handler: (params: TParams) => Promise<TResult>) =>
    (params: TParams) =>
      handler(params),
}));
vi.mock("@/lib/services/task.service", () => ({
  taskService: { createTask, moveSubtask },
}));
vi.mock("@/lib/clients/core.client", () => ({
  toCoreApiActionError: (error: Error) => ({
    code: "UNPROCESSABLE",
    message: error.message,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createSubtask", () => {
  it("sends the description, the assignee and the due date to Core", async () => {
    createTask.mockResolvedValue({ id: "child" });
    const { createSubtask } = await import("./subtask-action");

    const result = await createSubtask({
      parentTaskId: "parent",
      name: "Book the venue",
      description: "Ask for the corner table.",
      assigneeUserId: "user-1",
      dueOn: "2026-12-01",
    });

    expect(result.ok).toBe(true);
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        parentTaskId: "parent",
        status: TaskStatus.READY,
        description: "Ask for the corner table.",
        assigneeId: null,
        assigneeSokoBotId: null,
        assigneeUserId: "user-1",
        dueOn: "2026-12-01",
      }),
    );
  });
});

describe("setTaskParent", () => {
  it("detaches with a null parent and refreshes every task page", async () => {
    moveSubtask.mockResolvedValue({});
    const { setTaskParent } = await import("./subtask-action");

    await setTaskParent({ taskId: "child", parentTaskId: null });

    expect(moveSubtask).toHaveBeenCalledWith("child", { parentTaskId: null });
    expect(revalidatePath).toHaveBeenCalledWith("/tasks/[taskId]", "page");
    // The board shows root Tasks only, so a detached Task joins it.
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
  });

  it("returns Core's refusal and refreshes nothing", async () => {
    moveSubtask.mockRejectedValue(new Error("That would be a cycle."));
    const { setTaskParent } = await import("./subtask-action");

    const result = await setTaskParent({
      taskId: "child",
      parentTaskId: "grandchild",
    });

    expect(result).toEqual({
      ok: false,
      error: { code: "UNPROCESSABLE", message: "That would be a cycle." },
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
