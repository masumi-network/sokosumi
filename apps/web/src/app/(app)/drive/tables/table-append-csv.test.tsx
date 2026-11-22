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
  columns: [{ ...name, type: "text" as const }],
};

/** Core's query: `total` counts live rows, or archived ones when asked. */
function holds(
  rows: Array<{ values: Record<string, unknown> }>,
  { live = rows.length, archived = 0 } = {},
) {
  f.query.mockImplementation((_id: string, body: { archived?: boolean }) =>
    Promise.resolve(
      body.archived
        ? { rows: [], nextCursor: null, total: archived }
        : { rows, nextCursor: null, total: live },
    ),
  );
}

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
    holds([{ values: { [name.id]: "Ada" } }]);
    f.batch.mockResolvedValue({});
    const onDone = vi.fn();
    render(
      <TableAppendCsv
        table={table}
        onChanged={vi.fn()}
        onClose={vi.fn()}
        onDone={onDone}
      />,
    );

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
    holds([{ values: { [name.id]: "Ada" } }]);
    f.batch.mockResolvedValue({});
    const onDone = vi.fn();
    render(
      <TableAppendCsv
        table={table}
        onChanged={vi.fn()}
        onClose={vi.fn()}
        onDone={onDone}
      />,
    );

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
    holds([]);
    render(
      <TableAppendCsv
        table={table}
        onChanged={vi.fn()}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />,
    );

    choose("Email\na@b.c\n");

    expect(await screen.findByText("appendCsv.noMatch")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: 'appendCsv.add {"count":0}' })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("refuses a CSV that would take the Table past 10,000 rows", async () => {
    holds([], { live: 9_000, archived: 999 });
    render(
      <TableAppendCsv
        table={table}
        onChanged={vi.fn()}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />,
    );

    choose("Name\nAda\nBo\n");

    expect(
      await screen.findByText('appendCsv.full {"room":1,"count":2}'),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: 'appendCsv.add {"count":2}' })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("says a header is ambiguous and adds nothing", async () => {
    holds([]);
    render(
      <TableAppendCsv
        table={table}
        onChanged={vi.fn()}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />,
    );

    choose("Name,name\nAda,Bo\n");

    expect(
      await screen.findByText('appendCsv.ambiguous {"columns":"Name, name"}'),
    ).toBeTruthy();
  });

  it("shows what a failed add already wrote and retries the same batches", async () => {
    holds([]);
    f.batch
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("Network down"))
      .mockResolvedValue({});
    const onChanged = vi.fn();
    const onDone = vi.fn();
    render(
      <TableAppendCsv
        table={table}
        onChanged={onChanged}
        onClose={vi.fn()}
        onDone={onDone}
      />,
    );
    const csv = ["Name", ...Array.from({ length: 150 }, (_, i) => `P${i}`)];
    choose(csv.join("\n"));
    fireEvent.click(
      await screen.findByRole("button", {
        name: 'appendCsv.add {"count":150}',
      }),
    );

    expect(
      await screen.findByText('appendCsv.stopped {"added":100,"count":150}'),
    ).toBeTruthy();
    expect(onChanged).toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "retry" }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith(150));
    const keys = f.batch.mock.calls.map((call) => call[1].key);
    expect(keys.slice(2)).toEqual(keys.slice(0, 2));
  });

  it("refreshes and retries the same batch when the first answer is lost", async () => {
    holds([]);
    f.batch
      .mockRejectedValueOnce(new Error("Network down"))
      .mockResolvedValue({});
    const onChanged = vi.fn();
    const onDone = vi.fn();
    render(
      <TableAppendCsv
        table={table}
        onChanged={onChanged}
        onClose={vi.fn()}
        onDone={onDone}
      />,
    );
    choose("Name\nAda\n");
    fireEvent.click(
      await screen.findByRole("button", { name: 'appendCsv.add {"count":1}' }),
    );

    expect(
      await screen.findByText('appendCsv.stopped {"added":0,"count":1}'),
    ).toBeTruthy();
    expect(onChanged).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "retry" }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith(1));
    expect(f.batch.mock.calls[1][1].key).toBe(f.batch.mock.calls[0][1].key);
  });

  it("keeps its live status in the accessibility tree when it is empty", () => {
    holds([]);
    render(
      <TableAppendCsv
        table={table}
        onChanged={vi.fn()}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />,
    );
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("");
    expect(status.className).not.toContain("empty:hidden");
  });

  it("hides Close while it reads the file", async () => {
    f.query.mockReturnValue(new Promise(() => {}));
    render(
      <TableAppendCsv
        table={table}
        onChanged={vi.fn()}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /close/i })).toBeTruthy();

    choose("Name\nAda\n");

    expect(await screen.findByText("appendCsv.reading")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /close/i })).toBeNull();
  });
});
