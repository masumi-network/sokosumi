import type { DataTable, TableColumn, TableRow } from "@sokosumi/core-client";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TableFillSeries } from "./table-fill-series";
import { seriesValue } from "./table-value";

const f = vi.hoisted(() => ({ query: vi.fn(), batch: vi.fn() }));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
  useFormatter: () => ({
    number: (value: number) => String(value),
    dateTime: (date: Date) => date.toISOString().slice(0, 10),
  }),
}));
vi.mock("@/lib/services/data-table.client", () => ({
  dataTableService: { query: f.query, batch: f.batch },
}));

const name = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Post",
  type: "text",
  options: [],
} as unknown as TableColumn;
const day = {
  id: "00000000-0000-4000-8000-000000000002",
  name: "Day",
  type: "date",
  options: [],
} as unknown as TableColumn;
const order = {
  id: "00000000-0000-4000-8000-000000000003",
  name: "Order",
  type: "number",
  options: [],
} as unknown as TableColumn;
const table = {
  id: "00000000-0000-4000-8000-000000000009",
  columns: [name, day, order],
} as unknown as DataTable;
const definition = {
  filters: [{ columnId: name.id, operator: "contains", value: "x" }],
  sort: { columnId: name.id, direction: "desc" },
  visibleColumnIds: [],
} as never;

function row(n: number, values: TableRow["values"]) {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    version: n,
    values: { [name.id]: `Post ${n}`, ...values },
  } as unknown as TableRow;
}
function page(rows: TableRow[], nextCursor: string | null = null) {
  return { rows, nextCursor, total: rows.length };
}
function open(column: TableColumn) {
  const onDone = vi.fn();
  const onClose = vi.fn();
  render(
    <TableFillSeries
      table={table}
      column={column}
      definition={definition}
      onClose={onClose}
      onDone={onDone}
    />,
  );
  return { onDone, onClose };
}
function set(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function submit(label: string | RegExp) {
  fireEvent.click(screen.getByRole("button", { name: label }));
}

describe("seriesValue", () => {
  it("counts numbers without float noise", () => {
    expect(seriesValue(1, 1, "day", 4)).toBe(5);
    expect(seriesValue(0.1, 0.1, "day", 2)).toBe(0.3);
    expect(seriesValue(10, -2.5, "day", 2)).toBe(5);
  });

  it("steps dates by days and weeks across month and year ends", () => {
    expect(seriesValue("2026-12-30", 1, "day", 3)).toBe("2027-01-02");
    expect(seriesValue("2026-12-01", 1, "week", 2)).toBe("2026-12-15");
    expect(seriesValue("2026-03-29", 1, "day", 1)).toBe("2026-03-30");
  });

  it("keeps a month step on the same day, or the month's last day", () => {
    expect(seriesValue("2026-01-31", 1, "month", 1)).toBe("2026-02-28");
    expect(seriesValue("2028-01-31", 1, "month", 1)).toBe("2028-02-29");
    expect(seriesValue("2026-01-31", 1, "month", 2)).toBe("2026-03-31");
    expect(seriesValue("2026-11-15", 1, "month", 3)).toBe("2027-02-15");
  });
});

describe("TableFillSeries", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("reads the rows in the view's order and fills them as one batch", async () => {
    f.query.mockResolvedValue(
      page([row(3, {}), row(1, {}), row(2, { [day.id]: "2026-12-15" })]),
    );
    f.batch.mockResolvedValue({ batchId: "b", rows: [] });
    const { onDone, onClose } = open(day);
    set("fillSeries.start", "2026-12-01");
    set("fillSeries.unit", "week");
    submit("fillSeries.preview");
    await screen.findByText(/fillSeries.changes/);
    expect(f.query).toHaveBeenCalledWith(table.id, {
      filters: [{ columnId: name.id, operator: "contains", value: "x" }],
      sort: { columnId: name.id, direction: "desc" },
      limit: 100,
      archived: false,
    });
    // Row 3 already holds its value, so it is left alone.
    const preview = screen.getAllByRole("listitem").map((i) => i.textContent);
    expect(preview).toEqual([
      'fillSeries.row {"position":1}Post 32026-12-01',
      'fillSeries.row {"position":2}Post 12026-12-08',
    ]);
    submit(/fillSeries.apply/);
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(2));
    expect(f.batch).toHaveBeenCalledWith(table.id, {
      patch: [
        { id: row(3, {}).id, version: 3, values: { [day.id]: "2026-12-01" } },
        { id: row(1, {}).id, version: 1, values: { [day.id]: "2026-12-08" } },
      ],
      key: expect.any(String),
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps filled cells and their slot when only empty cells are filled", async () => {
    f.query.mockResolvedValue(
      page([
        row(1, {}),
        row(2, { [order.id]: 99 }),
        row(3, { [order.id]: "" }),
      ]),
    );
    open(order);
    set("fillSeries.start", "10");
    set("fillSeries.step", "5");
    fireEvent.click(screen.getByLabelText("fillSeries.onlyEmpty"));
    submit("fillSeries.preview");
    await screen.findByText(/fillSeries.changes/);
    submit(/fillSeries.apply/);
    await waitFor(() => expect(f.batch).toHaveBeenCalled());
    expect(f.batch.mock.calls[0][1].patch.map((p: never) => p)).toEqual([
      { id: row(1, {}).id, version: 1, values: { [order.id]: 10 } },
      { id: row(3, {}).id, version: 3, values: { [order.id]: 20 } },
    ]);
  });

  it("refuses a view with more rows than one batch and writes nothing", async () => {
    f.query.mockResolvedValue(page([row(1, {})], "next"));
    open(order);
    set("fillSeries.start", "1");
    submit("fillSeries.preview");
    await screen.findByText('fillSeries.tooMany {"limit":100}');
    expect(f.batch).not.toHaveBeenCalled();
  });

  it("says so when every row already holds its value", async () => {
    f.query.mockResolvedValue(page([row(1, { [order.id]: 1 })]));
    open(order);
    set("fillSeries.start", "1");
    submit("fillSeries.preview");
    await screen.findByText("fillSeries.unchanged");
  });

  it("rejects a fractional step for dates without reading rows", async () => {
    open(day);
    set("fillSeries.start", "2026-12-01");
    set("fillSeries.step", "1.5");
    // The browser's step check blocks the button; a submit past it still fails.
    fireEvent.submit(
      screen
        .getByLabelText("fillSeries.step")
        .closest("form") as HTMLFormElement,
    );
    await screen.findByRole("alert");
    expect(f.query).not.toHaveBeenCalled();
  });
});
