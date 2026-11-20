import { describe, expect, it } from "vitest";
import {
  TaskResultTableTooLarge,
  taskResultTablePlan,
  taskTableSource,
} from "./task-result-table";

const source = { title: "Leads", description: "", projectId: null };
const untitled = (n: number) => `Column ${n}`;

describe("taskResultTablePlan", () => {
  it("copies header and rows, numbers only where nothing is lost", () => {
    const { table, batches } = taskResultTablePlan(
      [
        ["Company", "ZIP", "Employees", "Revenue"],
        ["Acme", "01234", "12", "$1,200"],
        ["Globex", "98765", "300", "900"],
      ],
      source,
      untitled,
      "key",
    );
    expect(table.columns.map((c) => [c.name, c.type])).toEqual([
      ["Company", "text"],
      ["ZIP", "text"],
      ["Employees", "number"],
      ["Revenue", "text"],
    ]);
    const [company, zip, employees, revenue] = table.columns.map((c) =>
      String(c.id),
    );
    expect(batches.flatMap((b) => b.insert).map((r) => r.values)).toEqual([
      {
        [company]: "Acme",
        [zip]: "01234",
        [employees]: 12,
        [revenue]: "$1,200",
      },
      {
        [company]: "Globex",
        [zip]: "98765",
        [employees]: 300,
        [revenue]: "900",
      },
    ]);
    expect(batches[0].key).toBe("key:0");
  });

  it("names blank headers, skips blank rows and pads short rows", () => {
    const { table, batches } = taskResultTablePlan(
      [["Name", " "], ["", ""], ["Ada"]],
      source,
      untitled,
      "key",
    );
    expect(table.columns.map((c) => c.name)).toEqual(["Name", "Column 2"]);
    const rows = batches.flatMap((b) => b.insert);
    expect(rows).toHaveLength(1);
    expect(rows[0].values).toEqual({ [String(table.columns[0].id)]: "Ada" });
  });

  it("refuses a table a Files Table cannot hold whole, before anything is created", () => {
    const plan = (cells: string[][]) => () =>
      taskResultTablePlan(cells, source, untitled, "key");
    const columns = Array.from({ length: 101 }, (_, i) => `c${i}`);
    expect(plan([columns, columns])).toThrow(TaskResultTableTooLarge);
    expect(plan([["n".repeat(101)], ["a"]])).toThrow(TaskResultTableTooLarge);
    expect(plan([["Notes"], ["x".repeat(20001)]])).toThrow(
      TaskResultTableTooLarge,
    );
    const wide = Array.from({ length: 60 }, (_, i) => `c${i}`);
    expect(plan([wide, wide.map(() => "x".repeat(20000))])).toThrow(
      TaskResultTableTooLarge,
    );
  });

  it("cuts only the Table title it writes itself", () => {
    const { table } = taskResultTablePlan(
      [["Name"], ["Ada"]],
      { ...source, title: "t".repeat(300) },
      untitled,
      "key",
    );
    expect(table.title).toHaveLength(160);
  });
});

describe("taskTableSource", () => {
  const task = {
    name: "Find leads",
    projectId: null,
    visibility: "PUBLIC" as const,
    organizationId: "org-1",
  };
  it("offers Save as table where the Table's readers can already read the Task", () => {
    expect(taskTableSource(task)).toEqual({
      title: "Find leads",
      projectId: null,
    });
    expect(
      taskTableSource({ ...task, visibility: "PRIVATE", organizationId: null }),
    ).toEqual({ title: "Find leads", projectId: null });
  });
  it("offers nothing for a private Task in an organization, whose Tables every member reads", () => {
    expect(taskTableSource({ ...task, visibility: "PRIVATE" })).toBeUndefined();
  });
});
