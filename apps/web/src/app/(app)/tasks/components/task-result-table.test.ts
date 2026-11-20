import { describe, expect, it } from "vitest";
import { taskResultTablePlan } from "./task-result-table";

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

  it("keeps within Table limits", () => {
    const header = Array.from({ length: 120 }, (_, i) => `h${i}`.repeat(60));
    const { table, batches } = taskResultTablePlan(
      [header, ["x".repeat(25000)]],
      { ...source, title: "t".repeat(300) },
      untitled,
      "key",
    );
    expect(table.columns).toHaveLength(100);
    expect(table.columns[0].name).toHaveLength(100);
    expect(table.title).toHaveLength(160);
    expect(
      batches[0].insert[0].values[String(table.columns[0].id)] as string,
    ).toHaveLength(20000);
  });
});
