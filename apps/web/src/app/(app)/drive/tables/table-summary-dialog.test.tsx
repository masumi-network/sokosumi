import type { DataTable, TableRow } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TableSummaryDialog } from "./table-summary-dialog";

const f = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
  useFormatter: () => ({ number: (value: number) => String(value) }),
}));
vi.mock("@/lib/services/data-table.client", () => ({
  dataTableService: { query: f.query },
}));

const stage = { id: "stage", name: "Stage", type: "single_select" };
const deal = { id: "deal", name: "Deal", type: "number" };
const table = {
  id: "table-1",
  columns: [{ id: "notes", name: "Notes", type: "long_text" }, stage, deal],
} as unknown as DataTable;
const row = (stageValue: string | null, dealValue: number) =>
  ({ values: { stage: stageValue, deal: dealValue } }) as unknown as TableRow;

afterEach(() => {
  cleanup();
  f.query.mockReset();
});

function open() {
  const onPick = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TableSummaryDialog table={table} onClose={vi.fn()} onPick={onPick} />
    </QueryClientProvider>,
  );
  return onPick;
}

it("summarizes every page of live rows, not only the first", async () => {
  f.query
    .mockResolvedValueOnce({ rows: [row("Won", 10)], nextCursor: "c1" })
    .mockResolvedValueOnce({
      rows: [row("Won", 5), row(null, 1)],
      nextCursor: null,
    });
  const onPick = open();

  expect(
    await screen.findByText('summary.scope {"count":3,"values":2}'),
  ).toBeTruthy();
  expect(f.query).toHaveBeenLastCalledWith("table-1", {
    archived: false,
    limit: 100,
    cursor: "c1",
  });
  // Long text is not offered: free text rarely repeats.
  const select = screen.getByLabelText("summary.groupBy");
  expect(within(select).queryByText("Notes")).toBeNull();

  const won = screen.getByRole("button", { name: "Won" }).closest("tr")!;
  expect(
    within(won)
      .getAllByRole("cell")
      .map((cell) => cell.textContent),
  ).toEqual(["Won", "2", "15"]);

  fireEvent.click(screen.getByRole("button", { name: "summary.empty" }));
  expect(onPick).toHaveBeenCalledWith(stage, null);
});
