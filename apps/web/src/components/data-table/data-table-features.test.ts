import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createAppColumnHelper, useAppTable } from "./create-data-table-hook";

interface SortRow {
  id: string;
  name: string;
  score: number;
  createdAt: string;
  startedAt: Date;
}

const columnHelper = createAppColumnHelper<SortRow>();

const columns = columnHelper.columns([
  columnHelper.accessor("name", { id: "name" }),
  columnHelper.accessor("score", { id: "score" }),
  // ISO strings: auto picks text/alphanumeric; explicit datetime also supported.
  columnHelper.accessor("createdAt", { id: "createdAt" }),
  columnHelper.accessor("startedAt", {
    id: "startedAt",
    sortFn: "datetime",
  }),
]);

const unsorted: SortRow[] = [
  {
    id: "3",
    name: "charlie",
    score: 5,
    createdAt: "2024-03-01T00:00:00.000Z",
    startedAt: new Date("2024-03-01T00:00:00.000Z"),
  },
  {
    id: "1",
    name: "alice",
    score: 20,
    createdAt: "2024-01-01T00:00:00.000Z",
    startedAt: new Date("2024-01-01T00:00:00.000Z"),
  },
  {
    id: "2",
    name: "bob",
    score: 10,
    createdAt: "2024-02-01T00:00:00.000Z",
    startedAt: new Date("2024-02-01T00:00:00.000Z"),
  },
];

function useSortTable() {
  return useAppTable({
    columns,
    data: unsorted,
    // Full page so row model is not truncated while testing sort order.
    initialState: {
      pagination: { pageIndex: 0, pageSize: 50 },
    },
  });
}

describe("dataTableFeatures sort registry", () => {
  it("sorts strings with default auto sortFn", () => {
    const { result } = renderHook(() => useSortTable());
    result.current.setSorting([{ id: "name", desc: false }]);

    expect(
      result.current.getRowModel().rows.map((row) => row.original.name),
    ).toEqual(["alice", "bob", "charlie"]);
  });

  it("sorts numbers with default auto sortFn", () => {
    const { result } = renderHook(() => useSortTable());
    result.current.setSorting([{ id: "score", desc: false }]);

    expect(
      result.current.getRowModel().rows.map((row) => row.original.score),
    ).toEqual([5, 10, 20]);
  });

  it("sorts ISO date strings with default auto sortFn", () => {
    const { result } = renderHook(() => useSortTable());
    result.current.setSorting([{ id: "createdAt", desc: false }]);

    expect(
      result.current.getRowModel().rows.map((row) => row.original.createdAt),
    ).toEqual([
      "2024-01-01T00:00:00.000Z",
      "2024-02-01T00:00:00.000Z",
      "2024-03-01T00:00:00.000Z",
    ]);
  });

  it("sorts Date values with named datetime sortFn", () => {
    const { result } = renderHook(() => useSortTable());
    result.current.setSorting([{ id: "startedAt", desc: false }]);

    expect(
      result.current
        .getRowModel()
        .rows.map((row) => row.original.startedAt.getTime()),
    ).toEqual([
      new Date("2024-01-01T00:00:00.000Z").getTime(),
      new Date("2024-02-01T00:00:00.000Z").getTime(),
      new Date("2024-03-01T00:00:00.000Z").getTime(),
    ]);
  });

  it("supports descending multi-toggle style sort", () => {
    const { result } = renderHook(() => useSortTable());
    result.current.setSorting([{ id: "name", desc: true }]);

    expect(
      result.current.getRowModel().rows.map((row) => row.original.name),
    ).toEqual(["charlie", "bob", "alice"]);
  });
});
