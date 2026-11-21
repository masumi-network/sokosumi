import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import { SpreadsheetFileView, SpreadsheetView } from "./spreadsheet-view";

const CSV = "Item,Price\nSourdough,6.50\nRye loaf,5.80\n";

afterEach(() => vi.unstubAllGlobals());

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
