import type { DataTable, TableColumn, TableRow } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { boardLanes, TableBoard } from "./table-board";

const query = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/data-table.client", () => ({
  dataTableService: { query },
}));
vi.mock("next-intl", () => ({
  useTranslations:
    () => (key: string, values?: Record<string, string | number>) =>
      values ? `${key}:${Object.values(values).join(",")}` : key,
}));

const name = { id: "name", name: "Name", type: "text" } as TableColumn;
const stage = {
  id: "stage",
  name: "Stage",
  type: "single_select",
  options: ["Lead", "Won"],
} as TableColumn;
const table = {
  id: "t1",
  columns: [name, stage],
} as unknown as DataTable;

function row(id: string, values: TableRow["values"]): TableRow {
  return { id, values, version: 1 } as unknown as TableRow;
}

it("groups rows by option in option order, with unset and unknown values in their own lanes", () => {
  const lanes = boardLanes(
    [
      row("a", { name: "Acme", stage: "Won" }),
      row("b", { name: "Beta", stage: null }),
      row("c", { name: "Cora", stage: "Lead" }),
      row("d", { name: "Dune", stage: "Lost" }),
    ],
    stage,
  );
  expect(lanes.map((lane) => [lane.value, lane.rows.map((r) => r.id)])).toEqual(
    [
      ["Lead", ["c"]],
      ["Won", ["a"]],
      ["Lost", ["d"]],
      [null, ["b"]],
    ],
  );
});

it("loads every page before grouping, so lane counts are complete", async () => {
  query
    .mockResolvedValueOnce({
      rows: [row("a", { name: "Acme", stage: "Won" })],
      nextCursor: "a",
    })
    .mockResolvedValueOnce({
      rows: [row("b", { name: "Beta", stage: "Won" })],
      nextCursor: null,
    });
  renderBoard(vi.fn());
  const won = await screen.findByRole("region", { name: "Won" });
  expect(within(won).getByText("Acme")).toBeInTheDocument();
  expect(within(won).getByText("Beta")).toBeInTheDocument();
  expect(query).toHaveBeenLastCalledWith("t1", {
    filters: [],
    sort: null,
    limit: 100,
    cursor: "a",
    archived: false,
  });
});

it("moves a card to another option from its Move to menu", async () => {
  query.mockResolvedValue({
    rows: [row("a", { name: "Acme", stage: "Lead" })],
    nextCursor: null,
  });
  const write = Promise.withResolvers<void>();
  const onMove = vi.fn(() => write.promise);
  renderBoard(onMove);
  await userEvent.click(
    await screen.findByRole("button", { name: "board.moveCard:Acme" }),
  );
  await userEvent.click(
    await screen.findByRole("menuitemradio", { name: "Won" }),
  );
  expect(onMove).toHaveBeenCalledWith(
    expect.objectContaining({ id: "a" }),
    "Won",
  );
  // Shown in its new lane while the write runs.
  expect(
    within(screen.getByRole("region", { name: "Won" })).getByText("Acme"),
  ).toBeInTheDocument();
  await act(async () => write.resolve());
  // The server still says Lead, so the card goes back once the write settles.
  await waitFor(() =>
    expect(
      within(screen.getByRole("region", { name: "Lead" })).getByText("Acme"),
    ).toBeInTheDocument(),
  );
});

it("says when the board shows only the first rows", async () => {
  let page = 0;
  query.mockImplementation(async () => {
    page += 1;
    return {
      rows: Array.from({ length: 100 }, (_, i) =>
        row(`p${page}r${i}`, { name: `Row ${i}`, stage: "Lead" }),
      ),
      nextCursor: "more",
    };
  });
  renderBoard(vi.fn());
  expect(await screen.findByText("board.truncated:500")).toBeInTheDocument();
});

function renderBoard(onMove: () => Promise<void>) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <TableBoard
        table={table}
        column={stage}
        columns={table.columns}
        definition={{ filters: [], sort: null }}
        onMove={onMove}
      />
    </QueryClientProvider>,
  );
}
