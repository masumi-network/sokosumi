import type { DataTable } from "@sokosumi/core-client";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TableAppendCsv } from "./table-append-csv";

const f = vi.hoisted(() => ({ query: vi.fn(), batch: vi.fn() }));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));
vi.mock("@/lib/services/data-table.client", () => ({
  dataTableService: { query: f.query, batch: f.batch },
}));

const name = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Name",
  type: "text",
  options: [],
};
const table = {
  id: "00000000-0000-4000-8000-000000000009",
  columns: [name],
} as unknown as DataTable;

function choose(text: string) {
  fireEvent.change(screen.getByLabelText("appendCsv.file"), {
    target: { files: [new File([text], "leads.csv", { type: "text/csv" })] },
  });
}

describe("TableAppendCsv", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("adds only the CSV rows the Table does not hold yet", async () => {
    f.query.mockResolvedValue({
      rows: [{ values: { [name.id]: "Ada" } }],
      nextCursor: null,
    });
    f.batch.mockResolvedValue({});
    const onDone = vi.fn();
    render(<TableAppendCsv table={table} onClose={vi.fn()} onDone={onDone} />);

    choose("Name,Notes\nAda,x\nBo,y\n");

    expect(
      await screen.findByText('appendCsv.skipped {"columns":"Notes"}'),
    ).toBeTruthy();
    const skip = screen.getByRole("checkbox", {
      name: 'appendCsv.skipDuplicates {"count":1}',
    });
    expect(skip.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(
      screen.getByRole("button", { name: 'appendCsv.add {"count":1}' }),
    );

    await waitFor(() => expect(onDone).toHaveBeenCalledWith(1));
    expect(f.batch).toHaveBeenCalledTimes(1);
    expect(f.batch.mock.calls[0][1].insert).toEqual([
      { values: { [name.id]: "Bo" }, evidence: {} },
    ]);
  });

  it("keeps rows already in the Table when asked", async () => {
    f.query.mockResolvedValue({
      rows: [{ values: { [name.id]: "Ada" } }],
      nextCursor: null,
    });
    f.batch.mockResolvedValue({});
    const onDone = vi.fn();
    render(<TableAppendCsv table={table} onClose={vi.fn()} onDone={onDone} />);

    choose("Name\nAda\nBo\n");
    fireEvent.click(
      await screen.findByRole("checkbox", {
        name: 'appendCsv.skipDuplicates {"count":1}',
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: 'appendCsv.add {"count":2}' }),
    );

    await waitFor(() => expect(onDone).toHaveBeenCalledWith(2));
  });

  it("says so when no CSV header matches a column", async () => {
    f.query.mockResolvedValue({ rows: [], nextCursor: null });
    render(<TableAppendCsv table={table} onClose={vi.fn()} onDone={vi.fn()} />);

    choose("Email\na@b.c\n");

    expect(await screen.findByText("appendCsv.noMatch")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: 'appendCsv.add {"count":0}' })
        .hasAttribute("disabled"),
    ).toBe(true);
  });
});
