import { describe, expect, it } from "vitest";
import type { TaskFormCreateInput } from "@/app/tasks/components/task-form";
import { getColumnId } from "@/app/tasks/utils/task-column";
import { buildPendingTask } from "./pending-created-task";

const options = { coworkerOptions: [], projectOptions: [] };

function createInput(
  overrides: Partial<TaskFormCreateInput>,
): TaskFormCreateInput {
  return {
    description: "",
    assigneeId: null,
    assigneeSokoBotId: null,
    assigneeUserId: null,
    status: "DRAFT",
    ...overrides,
  } as TaskFormCreateInput;
}

describe("buildPendingTask", () => {
  it("puts a Task with a Run at in the Queued column, with its time", () => {
    const runAt = "2026-12-01T09:00:00.000Z";
    const task = buildPendingTask(
      createInput({ name: "Report", status: "QUEUED", runAt }),
      options,
    );

    expect(task.columnId).toBe(getColumnId("QUEUED"));
    expect(task.runAt).toBe(runAt);
    expect(task.isPending).toBe(true);
  });

  it("shows the first description line for a Task without a name", () => {
    const task = buildPendingTask(
      createInput({ description: "Summarise the call\nSecond line" }),
      options,
    );

    expect(task.name).toBe("Summarise the call");
  });
});
