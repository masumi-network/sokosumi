import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createAppColumnHelper, useAppTable } from "../create-data-table-hook";

interface Row {
  id: string;
  name: string;
}

describe("create-data-table-hook", () => {
  it("useAppTable sorts without passing features", () => {
    const helper = createAppColumnHelper<Row>();
    const columns = helper.columns([helper.accessor("name", { id: "name" })]);

    const { result } = renderHook(() =>
      useAppTable({
        columns,
        data: [
          { id: "2", name: "bob" },
          { id: "1", name: "alice" },
        ],
        initialState: {
          pagination: { pageIndex: 0, pageSize: 50 },
          sorting: [{ id: "name", desc: false }],
        },
      }),
    );

    expect(
      result.current.getRowModel().rows.map((row) => row.original.name),
    ).toEqual(["alice", "bob"]);
  });

  it("createAppColumnHelper columns() needs no cast to pass into useAppTable", () => {
    const helper = createAppColumnHelper<Row>();
    const columns = helper.columns([
      helper.accessor("name", { id: "name" }),
      helper.display({ id: "actions", cell: () => null }),
    ]);

    const { result } = renderHook(() =>
      useAppTable({
        columns,
        data: [{ id: "1", name: "alice" }],
        initialState: { pagination: { pageIndex: 0, pageSize: 10 } },
      }),
    );

    expect(result.current.getAllColumns().map((c) => c.id)).toEqual([
      "name",
      "actions",
    ]);
  });

  it("accepts mixed-value columns array from columns() into useAppTable", () => {
    const helper = createAppColumnHelper<{
      id: string;
      n: number;
      s: string;
    }>();
    const columns = helper.columns([
      helper.accessor("s", { id: "s" }),
      helper.accessor("n", { id: "n" }),
    ]);
    const { result } = renderHook(() =>
      useAppTable({
        columns,
        data: [{ id: "1", n: 2, s: "a" }],
        initialState: { pagination: { pageIndex: 0, pageSize: 10 } },
      }),
    );
    expect(result.current.getRowModel().rows).toHaveLength(1);
  });
});
