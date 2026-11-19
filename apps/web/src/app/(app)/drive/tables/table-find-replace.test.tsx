import type { DataTable, TableRow } from "@sokosumi/core-client";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TableFindReplace } from "./table-find-replace";

const f = vi.hoisted(() => ({ query: vi.fn(), batch: vi.fn() }));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));
vi.mock("@/lib/services/data-table.client", () => ({
  dataTableService: { query: f.query, batch: f.batch },
}));

const company = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Company",
  type: "text",
  options: [],
};
const score = {
  id: "00000000-0000-4000-8000-000000000002",
  name: "Score",
  type: "number",
  options: [],
};
const updated = {
  id: "00000000-0000-4000-8000-000000000003",
  name: "Updated",
  type: "last_updated",
  options: [],
};
const table = {
  id: "00000000-0000-4000-8000-000000000009",
  columns: [company, score, updated],
} as unknown as DataTable;
function row(n: number) {
  return {
    id: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`,
    version: n,
    values: { [company.id]: "Acme Inc" },
  } as unknown as TableRow;
}

function fill(find: string, replace: string) {
  fireEvent.change(screen.getByLabelText("findReplace.find"), {
    target: { value: find },
  });
  fireEvent.change(screen.getByLabelText("findReplace.replace"), {
    target: { value: replace },
  });
}

describe("TableFindReplace", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("offers every column that stores a value", () => {
    render(
      <TableFindReplace table={table} onClose={vi.fn()} onDone={vi.fn()} />,
    );
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Company", "Score"]);
  });

  it("counts exact matches first, then replaces them in one batch", async () => {
    f.query.mockResolvedValue({ rows: [row(1), row(2)], total: 2 });
    f.batch.mockResolvedValue({ batchId: "b", rows: [] });
    const onDone = vi.fn();
    render(
      <TableFindReplace table={table} onClose={vi.fn()} onDone={onDone} />,
    );
    fill("Acme Inc", "Acme");
    fireEvent.click(
      screen.getByRole("button", { name: "findReplace.findMatches" }),
    );
    expect(
      await screen.findByText('findReplace.matches {"count":2}'),
    ).toBeTruthy();
    expect(f.query).toHaveBeenCalledWith(table.id, {
      filters: [
        { columnId: company.id, operator: "equals", value: "Acme Inc" },
      ],
      limit: 100,
      archived: false,
    });
    expect(f.batch).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: 'findReplace.apply {"count":2}' }),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(2));
    expect(f.batch).toHaveBeenCalledWith(table.id, {
      key: expect.any(String),
      patch: [
        { id: row(1).id, version: 1, values: { [company.id]: "Acme" } },
        { id: row(2).id, version: 2, values: { [company.id]: "Acme" } },
      ],
    });
  });

  it("refuses more than one batch of rows before writing", async () => {
    f.query.mockResolvedValue({ rows: [row(1)], total: 140 });
    render(
      <TableFindReplace table={table} onClose={vi.fn()} onDone={vi.fn()} />,
    );
    fill("Acme Inc", "Acme");
    fireEvent.click(
      screen.getByRole("button", { name: "findReplace.findMatches" }),
    );
    expect(
      await screen.findByText('findReplace.tooMany {"count":140,"limit":100}'),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /findReplace.apply/ }),
    ).toBeNull();
  });

  it("says when nothing matches", async () => {
    f.query.mockResolvedValue({ rows: [], total: 0 });
    render(
      <TableFindReplace table={table} onClose={vi.fn()} onDone={vi.fn()} />,
    );
    fill("Nope", "Acme");
    fireEvent.click(
      screen.getByRole("button", { name: "findReplace.findMatches" }),
    );
    expect(await screen.findByText("findReplace.none")).toBeTruthy();
  });

  it("reads find and replace as the column's type and clears on empty", async () => {
    f.query.mockResolvedValue({
      rows: [{ ...row(1), values: { [score.id]: 3 } }],
      total: 1,
    });
    f.batch.mockResolvedValue({ batchId: "b", rows: [] });
    render(
      <TableFindReplace table={table} onClose={vi.fn()} onDone={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("findReplace.column"), {
      target: { value: score.id },
    });
    fill("3", "");
    fireEvent.click(
      screen.getByRole("button", { name: "findReplace.findMatches" }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: 'findReplace.apply {"count":1}',
      }),
    );
    await waitFor(() => expect(f.batch).toHaveBeenCalled());
    expect(f.query.mock.calls[0][1].filters[0].value).toBe(3);
    expect(f.batch.mock.calls[0][1].patch[0].values).toEqual({
      [score.id]: null,
    });
  });

  it("shows the column's input error instead of searching", () => {
    render(
      <TableFindReplace table={table} onClose={vi.fn()} onDone={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("findReplace.column"), {
      target: { value: score.id },
    });
    fill("three", "4");
    fireEvent.click(
      screen.getByRole("button", { name: "findReplace.findMatches" }),
    );
    expect(screen.getByRole("alert").textContent).toBe("errors.number");
    expect(f.query).not.toHaveBeenCalled();
  });

  it("asks to find again after the inputs change", async () => {
    f.query.mockResolvedValue({ rows: [row(1)], total: 1 });
    render(
      <TableFindReplace table={table} onClose={vi.fn()} onDone={vi.fn()} />,
    );
    fill("Acme Inc", "Acme");
    fireEvent.click(
      screen.getByRole("button", { name: "findReplace.findMatches" }),
    );
    await screen.findByText('findReplace.matches {"count":1}');
    fill("Acme Inc", "Acme Ltd");
    expect(screen.queryByText('findReplace.matches {"count":1}')).toBeNull();
    expect(
      screen.getByRole("button", { name: "findReplace.findMatches" }),
    ).toBeTruthy();
  });
});
