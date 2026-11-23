import type {
  DataTable,
  TableColumn,
  TableRow,
  TableView,
} from "@sokosumi/core-client";
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
    number: (value: number, options?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat("en", options).format(value),
    dateTime: (date: Date) => date.toISOString().slice(0, 10),
  }),
}));
vi.mock("@/lib/services/data-table.client", () => ({
  dataTableService: { query: f.query, batch: f.batch },
}));

const TABLE_ID = "00000000-0000-4000-8000-000000000009";
const EPOCH = new Date("2026-11-01T00:00:00Z");
function column(n: number, name: string, type: TableColumn["type"]) {
  return {
    id: `00000000-0000-4000-8000-00000000000${n}`,
    name,
    type,
    options: [],
    width: null,
    wrap: null,
    tableId: TABLE_ID,
    position: n,
    version: 1,
  } satisfies TableColumn;
}
const name = column(1, "Post", "text");
const day = column(2, "Day", "date");
const order = column(3, "Order", "number");
const table: DataTable = {
  id: TABLE_ID,
  workspaceId: "00000000-0000-4000-8000-000000000010",
  projectId: null,
  title: "Content plan",
  description: "",
  createdBy: "00000000-0000-4000-8000-000000000011",
  version: 1,
  archivedAt: null,
  createdAt: EPOCH,
  updatedAt: EPOCH,
  columns: [name, day, order],
  views: [],
};
const definition: TableView["definition"] = {
  filters: [{ columnId: name.id, operator: "contains", value: "x" }],
  sort: { columnId: name.id, direction: "desc" },
  visibleColumnIds: [],
};

function row(n: number, values: TableRow["values"]): TableRow {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    tableId: TABLE_ID,
    values: { [name.id]: `Post ${n}`, ...values },
    evidence: {},
    version: n,
    archivedAt: null,
    createdAt: EPOCH,
    updatedAt: EPOCH,
  };
}
function page(rows: TableRow[], nextCursor: string | null = null) {
  return { rows, nextCursor, total: rows.length };
}
function open(
  column: TableColumn,
  returnFocus?: React.RefObject<HTMLElement | null>,
) {
  const onDone = vi.fn();
  const onClose = vi.fn();
  render(
    <TableFillSeries
      table={table}
      column={column}
      definition={definition}
      returnFocus={returnFocus}
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

  it("keeps the precision people type, however small", () => {
    expect(seriesValue(1e-11, 1e-11, "day", 0)).toBe(1e-11);
    expect(seriesValue(1e-11, 1e-11, "day", 2)).toBe(3e-11);
    expect(seriesValue(0.0001, 0.0001, "day", 1)).toBe(0.0002);
    expect(seriesValue(1e300, 1e300, "day", 1)).toBe(2e300);
  });

  it("refuses a number past the largest one a cell holds", () => {
    expect(() => seriesValue(1e308, 1e308, "day", 1)).toThrow(
      "Series leaves the supported range",
    );
  });

  it("keeps years before 100 and refuses dates past year 9999", () => {
    expect(seriesValue("0099-01-01", 1, "day", 0)).toBe("0099-01-01");
    expect(seriesValue("0099-12-31", 1, "day", 1)).toBe("0100-01-01");
    expect(seriesValue("0050-01-31", 1, "month", 1)).toBe("0050-02-28");
    expect(seriesValue("0001-01-01", 1, "week", 1)).toBe("0001-01-08");
    expect(seriesValue("9999-12-31", 1, "day", 0)).toBe("9999-12-31");
    expect(() => seriesValue("9999-12-31", 1, "day", 1)).toThrow(
      "Series leaves the supported range",
    );
    expect(() => seriesValue("0000-01-01", -1, "month", 1)).toThrow(
      "Series leaves the supported range",
    );
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

  it("previews the exact number that is saved", async () => {
    f.query.mockResolvedValue(page([row(1, {}), row(2, {})]));
    open(order);
    set("fillSeries.start", "0.0001");
    set("fillSeries.step", "0.0001");
    submit("fillSeries.preview");
    await screen.findByText(/fillSeries.changes/);
    const preview = screen.getAllByRole("listitem").map((i) => i.textContent);
    expect(preview).toEqual([
      'fillSeries.row {"position":1}Post 10.0001',
      'fillSeries.row {"position":2}Post 20.0002',
    ]);
  });

  it("shows an error, not a preview, when the series leaves the range", async () => {
    f.query.mockResolvedValue(page([row(1, {}), row(2, {})]));
    open(day);
    set("fillSeries.start", "9999-12-31");
    submit("fillSeries.preview");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "errors.seriesRange",
    );
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("returns focus to the column menu button when closed", async () => {
    const button = document.createElement("button");
    document.body.append(button);
    const { onClose } = open(order, { current: button });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    cleanup();
    await waitFor(() => expect(document.activeElement).toBe(button));
    button.remove();
  });

  it("drops a refused plan so the next Preview reads fresh rows", async () => {
    f.query.mockResolvedValue(page([row(1, {})]));
    f.batch.mockRejectedValue({ error: "Conflict" });
    open(order);
    set("fillSeries.start", "1");
    submit("fillSeries.preview");
    await screen.findByText(/fillSeries.changes/);
    submit(/fillSeries.apply/);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "errors.conflict",
    );
    f.query.mockResolvedValue(page([row(7, {})]));
    const preview = await screen.findByRole("button", {
      name: "fillSeries.preview",
    });
    await waitFor(() => expect(preview).toBeEnabled());
    submit("fillSeries.preview");
    await screen.findByText(/fillSeries.changes/);
    expect(f.query).toHaveBeenCalledTimes(2);
  });

  it("keeps an unclear failure's plan and key to retry the same write", async () => {
    f.query.mockResolvedValue(page([row(1, {})]));
    f.batch
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ batchId: "b", rows: [] });
    const { onDone } = open(order);
    set("fillSeries.start", "1");
    submit("fillSeries.preview");
    await screen.findByText(/fillSeries.changes/);
    submit(/fillSeries.apply/);
    await screen.findByRole("alert");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /fillSeries.apply/ }),
      ).toBeEnabled(),
    );
    submit(/fillSeries.apply/);
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(1));
    const [first, second] = f.batch.mock.calls.map((call) => call[1]);
    expect(second).toEqual(first);
  });
});
