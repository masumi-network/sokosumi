import { act, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: { number?: number }) =>
    values?.number ? `${key} ${values.number}` : key,
}));

import { SpreadsheetFileView, SpreadsheetView } from "./spreadsheet-view";

const CSV = "Item,Price\nSourdough,6.50\nRye loaf,5.80\n";

afterEach(() => vi.unstubAllGlobals());

function renderCsv(text: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(text)),
  );
  render(<SpreadsheetFileView url="/file.csv" kind="csv" />);
}

describe("SpreadsheetFileView", () => {
  it("shows a CSV's first row as pinned column headers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(CSV)),
    );
    render(<SpreadsheetFileView url="/prices.csv" kind="csv" />);

    const headers = await screen.findAllByRole("columnheader");
    expect(headers.map((cell) => cell.textContent)).toEqual(["Item", "Price"]);
    expect(headers[1]?.className).toContain("text-end");
    expect(headers[0]?.closest("thead")?.className).toContain("sticky");

    // The data rows stay whole below the header.
    const [, ...rows] = screen.getAllByRole("row");
    expect(rows.map((row) => within(row).getAllByRole("cell").length)).toEqual([
      2, 2,
    ]);
    expect(screen.getByRole("cell", { name: "Rye loaf" })).toBeVisible();
  });

  it.each([
    ["missing", "Item\nRye,5.80\n"],
    ["blank", "Item,\nRye,5.80\n"],
  ])("names a column whose first-row label is %s", async (_case, text) => {
    renderCsv(text);

    const headers = await screen.findAllByRole("columnheader");
    expect(headers.map((cell) => cell.textContent)).toEqual([
      "Item",
      "column 2",
    ]);
    expect(screen.getAllByRole("cell").map((c) => c.textContent)).toEqual([
      "Rye",
      "5.80",
    ]);
  });

  it("pins the header only while its rendered height leaves room for the rows", async () => {
    // happy-dom has no layout: heights and resize callbacks are set by hand.
    const resized: ResizeObserverCallback[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resized.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    const label = "W ".repeat(60).trim();
    renderCsv(`"${label}",Price\nRye,5.80\n`);
    const [first] = await screen.findAllByRole("columnheader");
    const head = first?.closest("thead") as HTMLElement;
    const scroller = head.closest("table")?.parentElement as HTMLElement;
    let headHeight = 32;
    let scrollerHeight = 560;
    Object.defineProperty(head, "offsetHeight", { get: () => headHeight });
    Object.defineProperty(scroller, "clientHeight", {
      get: () => scrollerHeight,
    });
    const resize = (next: { head?: number; scroller?: number }) =>
      act(() => {
        headHeight = next.head ?? headHeight;
        scrollerHeight = next.scroller ?? scrollerHeight;
        for (const callback of resized) callback([], {} as ResizeObserver);
      });

    resize({});
    expect(head.className).toContain("sticky");
    // The window shrinks and the text is enlarged: the wrapped label now
    // takes most of the preview, so it scrolls with the rows instead.
    resize({ head: 264, scroller: 177 });
    expect(head.className).not.toContain("sticky");
    // The whole label stays on screen and named as the column's header.
    expect(first?.textContent).toBe(label);
    expect(first?.querySelector("[class*='line-clamp']")).toBeNull();
    // Back to normal size: pinned again.
    resize({ head: 32, scroller: 560 });
    expect(head.className).toContain("sticky");
  });
});

describe("SpreadsheetView", () => {
  it("keeps every row as data when the sheet has no header row", () => {
    const cell = (text: string) => ({ text, numeric: false, bold: false });
    render(
      <SpreadsheetView
        sheets={[
          {
            name: "Sheet1",
            rows: [[cell("Item")], [cell("Sourdough")]],
            truncated: false,
            size: { rows: 2, columns: 1 },
            images: [],
          },
        ]}
      />,
    );

    expect(screen.queryByRole("columnheader")).toBeNull();
    expect(screen.getAllByRole("cell").map((c) => c.textContent)).toEqual([
      "Item",
      "Sourdough",
    ]);
  });
});
