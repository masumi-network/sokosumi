import type { TableColumn, TableRow } from "@sokosumi/core-client";
import { expect, it } from "vitest";
import { summarizeTableRows } from "./table-summary";

const column = (id: string, type: TableColumn["type"]) =>
  ({ id, type, name: id }) as TableColumn;
const row = (values: TableRow["values"]) => ({ values }) as TableRow;

const stage = column("stage", "single_select");
const deal = column("deal", "number");

it("counts rows per value, totals number columns, and keeps empty last", () => {
  const summary = summarizeTableRows(
    [
      row({ stage: "Won", deal: 100 }),
      row({ stage: "Lead", deal: null }),
      row({ stage: "Won", deal: 50.5 }),
      row({ deal: 7 }),
      row({ stage: "Lead" }),
      row({ stage: "Lost", deal: 3 }),
    ],
    stage,
    [deal],
  );
  expect(summary.groups).toEqual([
    { value: "Lead", count: 2, sums: [null] },
    { value: "Won", count: 2, sums: [150.5] },
    { value: "Lost", count: 1, sums: [3] },
    { value: null, count: 1, sums: [7] },
  ]);
  expect(summary.total).toEqual({ count: 6, sums: [160.5] });
});

it("counts a row under each of its options in a multiple select", () => {
  const tags = column("tags", "multiple_select");
  const summary = summarizeTableRows(
    [row({ tags: ["a", "b"] }), row({ tags: ["b"] }), row({ tags: [] })],
    tags,
    [],
  );
  expect(summary.groups).toEqual([
    { value: "b", count: 2, sums: [] },
    { value: "a", count: 1, sums: [] },
    { value: null, count: 1, sums: [] },
  ]);
  expect(summary.total.count).toBe(3);
});

it("keeps checkbox false apart from an empty cell", () => {
  const done = column("done", "checkbox");
  const summary = summarizeTableRows(
    [row({ done: false }), row({ done: true }), row({ done: false }), row({})],
    done,
    [],
  );
  expect(summary.groups.map((group) => [group.value, group.count])).toEqual([
    [false, 2],
    [true, 1],
    [null, 1],
  ]);
});
