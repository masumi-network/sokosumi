import type { DataTable, TableColumn, TableRow } from "@sokosumi/core-client";
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
vi.mock("next-intl", async (original) => {
  const intl = await original<typeof import("next-intl")>();
  // The real formatter, so the test sees what readers see.
  const formatter = intl.createFormatter({ locale: "en", timeZone: "UTC" });
  return {
    useTranslations: () => (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
    useFormatter: () => formatter,
  };
});
vi.mock("@/lib/services/data-table.client", () => ({
  dataTableService: { query: f.query },
}));

const column = (
  id: string,
  name: string,
  type: TableColumn["type"],
): TableColumn => ({
  id,
  name,
  type,
  options: [],
  width: null,
  wrap: null,
  tableId: "table-1",
  position: 0,
  version: 1,
});
const stage = column("stage", "Stage", "single_select");
const deal = column("deal", "Deal", "number");
const tags = column("tags", "Tags", "multiple_select");
const table: DataTable = {
  id: "table-1",
  workspaceId: "workspace",
  projectId: null,
  title: "Pipeline",
  description: "",
  createdBy: "user",
  version: 1,
  archivedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  columns: [column("notes", "Notes", "long_text"), stage, deal, tags],
  views: [],
};
const row = (values: TableRow["values"]): TableRow => ({
  id: crypto.randomUUID(),
  tableId: "table-1",
  values,
  evidence: {},
  version: 1,
  archivedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

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
    .mockResolvedValueOnce({
      rows: [row({ stage: "Won", deal: 10 })],
      nextCursor: "c1",
    })
    .mockResolvedValueOnce({
      rows: [row({ stage: "Won", deal: 5 }), row({ stage: null, deal: 1 })],
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

it("names a multiple select stored with no options apart from a missing value", async () => {
  f.query.mockResolvedValueOnce({
    rows: [row({ tags: [] }), row({}), row({ tags: ["a"] })],
    nextCursor: null,
  });
  const onPick = open();
  await screen.findByText(/^summary\.scope/);
  fireEvent.change(screen.getByLabelText("summary.groupBy"), {
    target: { value: "tags" },
  });
  fireEvent.click(screen.getByRole("button", { name: "summary.noOptions" }));
  expect(onPick).toHaveBeenCalledWith(tags, []);
  expect(screen.getByRole("button", { name: "summary.empty" })).toBeTruthy();
});

it("keeps small numbers apart and totals them without rounding to zero", async () => {
  f.query.mockResolvedValueOnce({
    rows: [
      row({ deal: 0, stage: "Won" }),
      row({ deal: 0.0004, stage: "Won" }),
      row({ deal: 1234567.5, stage: "Lead" }),
    ],
    nextCursor: null,
  });
  open();
  await screen.findByText(/^summary\.scope/);
  fireEvent.change(screen.getByLabelText("summary.groupBy"), {
    target: { value: "deal" },
  });
  expect(screen.getByRole("button", { name: "0" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "0.0004" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "1,234,567.5" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("summary.groupBy"), {
    target: { value: "stage" },
  });
  const won = screen.getByRole("button", { name: "Won" }).closest("tr")!;
  expect(
    within(won)
      .getAllByRole("cell")
      .map((cell) => cell.textContent),
  ).toEqual(["Won", "2", "0.0004"]);
});
