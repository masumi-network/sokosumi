import type { DataTable, TableRow } from "@sokosumi/core-client";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createRef } from "react";
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
const notes = {
  id: "00000000-0000-4000-8000-000000000002",
  name: "Notes",
  type: "long_text",
  options: [],
};
const others = ["number", "date", "checkbox", "single_select", "last_updated"];
const table = {
  id: "00000000-0000-4000-8000-000000000009",
  columns: [
    company,
    notes,
    ...others.map((type, i) => ({
      id: `00000000-0000-4000-8000-00000000002${i}`,
      name: type,
      type,
      options: [],
    })),
  ],
} as unknown as DataTable;
function row(n: number, value: string, columnId = company.id) {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    version: n,
    values: { [columnId]: value },
  } as unknown as TableRow;
}
function page(rows: TableRow[], nextCursor: string | null = null) {
  return { rows, nextCursor, total: rows.length };
}
function fill(find: string, replace: string) {
  fireEvent.change(screen.getByLabelText("findReplace.find"), {
    target: { value: find },
  });
  fireEvent.change(screen.getByLabelText("findReplace.replace"), {
    target: { value: replace },
  });
}
function findMatches() {
  fireEvent.click(
    screen.getByRole("button", { name: "findReplace.findMatches" }),
  );
}
function open(returnFocus?: React.RefObject<HTMLElement | null>) {
  const onDone = vi.fn();
  const onClose = vi.fn();
  render(
    <TableFindReplace
      table={table}
      returnFocus={returnFocus}
      onClose={onClose}
      onDone={onDone}
    />,
  );
  return { onDone, onClose };
}

describe("TableFindReplace", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("keeps the Find field focused and enabled while it searches", async () => {
    let resolve: (value: ReturnType<typeof page>) => void = () => {};
    f.query.mockReturnValue(new Promise((done) => (resolve = done)));
    open();
    fill("acme", "Acme");
    const find = screen.getByLabelText("findReplace.find");
    find.focus();
    fireEvent.submit(find.closest("form") as HTMLFormElement);
    await waitFor(() => expect(f.query).toHaveBeenCalled());
    expect(find).not.toBeDisabled();
    expect(find).toHaveAttribute("readonly");
    resolve(page([]));
    await screen.findByText("findReplace.none");
    expect(document.activeElement).toBe(find);
    expect(find).not.toHaveAttribute("readonly");
  });

  it("offers only text columns", () => {
    open();
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Company", "Notes"]);
  });

  it("matches whole cells ignoring case, then replaces them in one batch", async () => {
    f.query.mockResolvedValue(
      page([row(1, "Acme Inc"), row(2, "ACME INC"), row(3, "Acme Inc Ltd")]),
    );
    f.batch.mockResolvedValue({ batchId: "b", rows: [] });
    const { onDone } = open();
    fill("acme inc", "Acme");
    findMatches();
    expect(
      await screen.findByText('findReplace.matches {"count":2}'),
    ).toBeTruthy();
    expect(f.query).toHaveBeenCalledWith(table.id, {
      filters: [
        { columnId: company.id, operator: "contains", value: "acme inc" },
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
        { id: row(1, "").id, version: 1, values: { [company.id]: "Acme" } },
        { id: row(2, "").id, version: 2, values: { [company.id]: "Acme" } },
      ],
    });
  });

  it("matches case the way Core's filter does, letter by letter", async () => {
    f.query.mockResolvedValue(page([row(1, "ΟΣ"), row(2, "ος")]));
    open();
    fill("οσ", "Ω");
    findMatches();
    // Postgres lower() maps Σ to σ, never to the final ς, so only ΟΣ is a candidate match.
    expect(
      await screen.findByText('findReplace.matches {"count":1}'),
    ).toBeTruthy();
  });

  it("reads candidates in one request and refuses when more than one page contains the text", async () => {
    const rows = Array.from({ length: 100 }, (_, i) => row(i + 1, "Acme Co"));
    f.query.mockResolvedValue(page(rows, "next"));
    open();
    fill("Acme", "Globex");
    findMatches();
    expect(
      await screen.findByText('findReplace.tooMany {"limit":100}'),
    ).toBeTruthy();
    expect(f.query).toHaveBeenCalledTimes(1);
    expect(f.query.mock.calls[0][1]).not.toHaveProperty("cursor");
    expect(
      screen.queryByRole("button", { name: /findReplace.apply/ }),
    ).toBeNull();
  });

  it("leaves cells that already hold the new value, and their sources, alone", async () => {
    f.query.mockResolvedValue(page([row(1, "Acme"), row(2, "acme")]));
    f.batch.mockResolvedValue({ batchId: "b", rows: [] });
    open();
    fill("acme", "Acme");
    findMatches();
    fireEvent.click(
      await screen.findByRole("button", {
        name: 'findReplace.apply {"count":1}',
      }),
    );
    await waitFor(() => expect(f.batch).toHaveBeenCalled());
    expect(
      f.batch.mock.calls[0][1].patch.map((p: { id: string }) => p.id),
    ).toEqual([row(2, "").id]);
  });

  it("says when every match already holds the new value", async () => {
    f.query.mockResolvedValue(page([row(1, "Acme")]));
    open();
    fill("acme", "Acme");
    findMatches();
    expect(await screen.findByText("findReplace.unchanged")).toBeTruthy();
  });

  it("says when nothing matches", async () => {
    f.query.mockResolvedValue(page([row(1, "Acme Inc")]));
    open();
    fill("Acme", "Globex");
    findMatches();
    expect(await screen.findByText("findReplace.none")).toBeTruthy();
  });

  it("keeps line breaks in long text and clears on an empty replacement", async () => {
    f.query.mockResolvedValue(page([row(1, "Line one\nLine two", notes.id)]));
    f.batch.mockResolvedValue({ batchId: "b", rows: [] });
    open();
    fireEvent.change(screen.getByLabelText("findReplace.column"), {
      target: { value: notes.id },
    });
    expect(screen.getByLabelText("findReplace.find").tagName).toBe("TEXTAREA");
    fill("line one\nline two", "");
    findMatches();
    expect(f.query.mock.calls[0][1].filters[0].value).toBe(
      "line one\nline two",
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: 'findReplace.apply {"count":1}',
      }),
    );
    await waitFor(() => expect(f.batch).toHaveBeenCalled());
    expect(f.batch.mock.calls[0][1].patch[0].values).toEqual({
      [notes.id]: null,
    });
  });

  it("refuses a replacement too large to send in one request", async () => {
    const rows = Array.from({ length: 100 }, (_, i) => row(i + 1, "Acme"));
    f.query.mockResolvedValue(page(rows));
    open();
    fill("Acme", "x".repeat(12_000));
    findMatches();
    expect((await screen.findByRole("alert")).textContent).toBe(
      "errors.requestSize",
    );
    expect(
      screen.queryByRole("button", { name: /findReplace.apply/ }),
    ).toBeNull();
  });

  it("asks to find again after the inputs change", async () => {
    f.query.mockResolvedValue(page([row(1, "Acme Inc")]));
    open();
    fill("Acme Inc", "Acme");
    findMatches();
    await screen.findByText('findReplace.matches {"count":1}');
    fill("Acme Inc", "Acme Ltd");
    expect(screen.queryByText('findReplace.matches {"count":1}')).toBeNull();
    expect(
      screen.getByRole("button", { name: "findReplace.findMatches" }),
    ).toBeTruthy();
  });

  it("returns focus to the given control when closed with Escape", async () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    const ref = createRef<HTMLElement>();
    (ref as { current: HTMLElement }).current = trigger;
    const { onClose } = open(ref);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    cleanup();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    trigger.remove();
  });
  it("counts the request key against the 1 MB limit", async () => {
    // Patch bytes without the key, for 100 rows whose versions add `extra` digits.
    const ids = Array.from({ length: 100 }, (_, i) => row(i + 1, "Acme"));
    const bytes = (value: string, extra: number) =>
      new Blob([
        JSON.stringify({
          patch: ids.map((r, i) => ({
            id: r.id,
            version: i < extra ? r.version * 10 : r.version,
            values: { [company.id]: value },
          })),
        }),
      ]).size;
    const length = Math.floor((1_000_000 - 20 - bytes("", 0)) / 100);
    const extra = 1_000_000 - 20 - bytes("x".repeat(length), 0);
    expect(extra).toBeGreaterThanOrEqual(0);
    expect(extra).toBeLessThan(100);
    // 20 bytes under the cap without the key; the key's 49 bytes push it over.
    expect(bytes("x".repeat(length), extra)).toBe(1_000_000 - 20);
    f.query.mockResolvedValue(
      page(
        ids.map((r, i) =>
          i < extra ? ({ ...r, version: r.version * 10 } as TableRow) : r,
        ),
      ),
    );
    open();
    fill("Acme", "x".repeat(length));
    findMatches();
    expect((await screen.findByRole("alert")).textContent).toBe(
      "errors.requestSize",
    );
  });
});
