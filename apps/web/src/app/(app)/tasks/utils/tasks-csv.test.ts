import { TaskPriority, TaskStatus } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import { type TaskCsvRow, type TasksCsvLabels, tasksCsv } from "./tasks-csv";

const labels = {
  columns: {
    identifier: "ID",
    name: "Name",
    status: "Status",
    priority: "Priority",
    assignee: "Assignee",
    owner: "Owner",
    project: "Project",
    dueOn: "Due",
    createdAt: "Created",
    updatedAt: "Updated",
  },
  status: { [TaskStatus.READY]: "Ready" },
  priority: { [TaskPriority.HIGH]: "High" },
} as unknown as TasksCsvLabels;

const row: TaskCsvRow = {
  identifier: "SOK-1",
  name: "Ship it",
  status: TaskStatus.READY,
  priority: TaskPriority.HIGH,
  assignee: null,
  owner: "Ada",
  project: null,
  dueOn: "2026-11-20",
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-02T10:00:00.000Z",
};

describe("tasksCsv", () => {
  it("names status and priority and leaves missing fields empty", () => {
    const lines = tasksCsv([row], labels)
      .replace(/^\uFEFF/, "")
      .split("\r\n");

    expect(lines[0]).toBe(
      '"ID","Name","Status","Priority","Assignee","Owner","Project","Due","Created","Updated"',
    );
    expect(lines[1]).toBe(
      '"SOK-1","Ship it","Ready","High","","Ada","","2026-11-20","2026-11-01T10:00:00.000Z","2026-11-02T10:00:00.000Z"',
    );
  });

  it("keeps a Task name that looks like a formula as text", () => {
    const csv = tasksCsv([{ ...row, name: '=HYPERLINK("x")' }], labels);

    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });
});
