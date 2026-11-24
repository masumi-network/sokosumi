import { describe, expect, it, vi } from "vitest";
import { archivedTaskMiss } from "./archived-task-miss";

const { readTask } = vi.hoisted(() => ({ readTask: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
  notFound: () => {
    throw new Error("not found");
  },
}));
vi.mock("@/lib/services/task.service", () => ({
  taskService: { getTaskById: readTask },
}));

describe("archivedTaskMiss", () => {
  it("opens the live Task when it was restored since the link was made", async () => {
    readTask.mockResolvedValue({ id: "task-1" });
    await expect(archivedTaskMiss("task-1")).rejects.toThrow(
      "redirect /tasks/task-1",
    );
  });

  it("shows not found when the Task is gone", async () => {
    readTask.mockResolvedValue(null);
    await expect(archivedTaskMiss("task-1")).rejects.toThrow("not found");
  });
});
