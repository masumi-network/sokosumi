import { describe, expect, it } from "vitest";
import type { TaskWithCoworker } from "@/app/tasks/types/task-board";
import { tasksTablePlan } from "./tasks-table-plan";

const task = (over: Partial<TaskWithCoworker>): TaskWithCoworker =>
  ({
    id: "11111111-1111-4111-8111-111111111111",
    identifier: null,
    name: "Write launch post",
    status: "READY",
    project: null,
    assignee: null,
    workspaceTags: [],
    dueOn: null,
    ...over,
  }) as TaskWithCoworker;

const labels = {
  columns: {
    name: "Task",
    status: "Status",
    assignee: "Assignee",
    project: "Project",
    due: "Due",
    tags: "Tags",
    link: "Link",
  },
  statuses: { READY: "To do", COMPLETED: "Done" } as Record<string, string>,
};
const source = {
  title: "Tasks · 18 Nov 2026",
  description: "",
  projectId: null,
};

describe("tasksTablePlan", () => {
  it("copies each Task as one row with readable values and a link back", () => {
    const { table, batches } = tasksTablePlan(
      [
        task({
          identifier: "SPR-4",
          status: "COMPLETED",
          assignee: { id: "u1", name: "Ada Lovelace", kind: "user" },
          project: { id: "p1", name: "Spring launch" } as never,
          dueOn: "2026-11-20",
          workspaceTags: [
            { id: "t1", displayName: "Launch" },
            { id: "t2", displayName: "Blog" },
          ],
        }),
        task({ id: "22222222-2222-4222-8222-222222222222", name: "Plan" }),
      ],
      { labels, source, origin: "https://app.example.com" },
      "copy-1",
    );

    expect(table.columns.map((c) => [c.name, c.type])).toEqual([
      ["Task", "text"],
      ["Status", "single_select"],
      ["Assignee", "text"],
      ["Project", "text"],
      ["Due", "date"],
      ["Tags", "multiple_select"],
      ["Link", "url"],
    ]);
    expect(table.columns[1].options).toEqual(["Done", "To do"]);
    expect(table.columns[5].options).toEqual(["Blog", "Launch"]);

    const ids = table.columns.map((c) => c.id as string);
    const [first, second] = batches[0].insert;
    expect(first.values).toEqual({
      [ids[0]]: "Write launch post",
      [ids[1]]: "Done",
      [ids[2]]: "Ada Lovelace",
      [ids[3]]: "Spring launch",
      [ids[4]]: "2026-11-20",
      [ids[5]]: ["Launch", "Blog"],
      [ids[6]]: "https://app.example.com/tasks/SPR-4-write-launch-post",
    });
    // Blank stays blank: no assignee, project, due date or tags.
    expect(second.values).toEqual({
      [ids[0]]: "Plan",
      [ids[1]]: "To do",
      [ids[6]]:
        "https://app.example.com/tasks/22222222-2222-4222-8222-222222222222",
    });
  });

  it("leaves out a Task still being created, since it has no page yet", () => {
    const { batches } = tasksTablePlan(
      [task({}), task({ id: "pending", isPending: true })],
      { labels, source, origin: "https://app.example.com" },
      "copy-2",
    );
    expect(batches.flatMap((b) => b.insert)).toHaveLength(1);
  });

  it("leaves out private Tasks: teammates who can open the table cannot open them", () => {
    const shared = (tasks: TaskWithCoworker[]) =>
      tasksTablePlan(
        tasks,
        { labels, source, origin: "https://app.example.com" },
        "copy-p",
      ).batches.flatMap((b) => b.insert);
    const secret = task({
      id: "secret",
      name: "Salary review",
      visibility: "PRIVATE",
    });
    expect(shared([task({}), secret])).toHaveLength(1);
    expect(JSON.stringify(shared([task({}), secret]))).not.toContain("Salary");
    expect(shared([secret])).toHaveLength(0);
  });

  it("splits more than 100 Tasks into batches under one key", () => {
    const many = Array.from({ length: 150 }, (_, i) =>
      task({ id: `id-${i}`, name: `Task ${i}` }),
    );
    const { batches } = tasksTablePlan(
      many,
      { labels, source, origin: "https://app.example.com" },
      "copy-3",
    );
    expect(batches.map((b) => [b.key, b.insert.length])).toEqual([
      ["copy-3:0", 100],
      ["copy-3:100", 50],
    ]);
  });
});
