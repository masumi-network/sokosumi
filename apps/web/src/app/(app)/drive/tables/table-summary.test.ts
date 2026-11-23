import type { TableColumn, TableRow } from "@sokosumi/core-client";
import { expect, it } from "vitest";
import { summarizeTableRows, summaryFilter } from "./table-summary";

const column = (id: string, type: TableColumn["type"]): TableColumn => ({
  id,
  type,
  name: id,
  options: [],
  width: null,
  wrap: null,
  tableId: "table",
  position: 0,
  version: 1,
});
const row = (values: TableRow["values"]): TableRow => ({
  id: crypto.randomUUID(),
  tableId: "table",
  values,
  evidence: {},
  version: 1,
  archivedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

const stage = column("stage", "single_select");
const deal = column("deal", "number");
const tags = column("tags", "multiple_select");

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
  const summary = summarizeTableRows(
    [row({ tags: ["a", "b"] }), row({ tags: ["b"] }), row({})],
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

it("keeps stored [] and blank text apart from a missing value, as Core's filters do", () => {
  const text = column("text", "text");
  expect(
    summarizeTableRows([row({ tags: [] }), row({})], tags, []).groups.map(
      (group) => group.value,
    ),
  ).toEqual([[], null]);
  expect(
    summarizeTableRows(
      [row({ text: "" }), row({ text: null }), row({ text: "" })],
      text,
      [],
    ).groups.map((group) => [group.value, group.count]),
  ).toEqual([
    ["", 2],
    [null, 1],
  ]);
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

it("filters to exactly the rows a group counted", () => {
  expect(summaryFilter(stage, "Won")).toEqual({
    columnId: "stage",
    operator: "equals",
    value: "Won",
  });
  expect(summaryFilter(tags, "a")).toEqual({
    columnId: "tags",
    operator: "contains",
    value: ["a"],
  });
  expect(summaryFilter(tags, [])).toEqual({
    columnId: "tags",
    operator: "equals",
    value: [],
  });
  expect(summaryFilter(stage, null)).toEqual({
    columnId: "stage",
    operator: "empty",
  });
  expect(summaryFilter(deal, 0)).toEqual({
    columnId: "deal",
    operator: "equals",
    value: 0,
  });
});
