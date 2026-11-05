import type { TableColumn, TableRow } from "@sokosumi/core-client";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GridMove } from "@/components/data-grid/grid-keys";
import { TableCell, TableUpdatedCell } from "./table-cell";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({
    // A named format (Last updated) reads back as `name:iso`; options format.
    dateTime: (date: Date, format: string | Intl.DateTimeFormatOptions) =>
      typeof format === "string"
        ? `${format}:${date.toISOString()}`
        : new Intl.DateTimeFormat("en-GB", format).format(date),
  }),
}));
const column: TableColumn = {
  id: "00000000-0000-4000-8000-000000000001",
  tableId: "00000000-0000-4000-8000-000000000002",
  name: "Company",
  description: "",
  type: "text",
  options: [],
  position: 0,
  version: 1,
  width: null,
  wrap: null,
};
const row: TableRow = {
  id: "00000000-0000-4000-8000-000000000003",
  tableId: column.tableId,
  values: { [column.id]: "Original" },
  evidence: {},
  version: 1,
  archivedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};
type CellProps = React.ComponentProps<typeof TableCell>;
function cellElement(props: Partial<CellProps> = {}) {
  return (
    <table>
      <tbody>
        <tr>
          <TableCell
            id="cell"
            column={column}
            row={row}
            disabled={false}
            active={false}
            tabbable
            onActivate={() => {}}
            onNavigate={() => false}
            onSave={vi.fn()}
            onHistory={() => {}}
            {...props}
          />
        </tr>
      </tbody>
    </table>
  );
}
function renderCell(props: Partial<CellProps> = {}) {
  const result = render(cellElement(props));
  return {
    ...result,
    rerenderCell: (next: Partial<CellProps>) =>
      result.rerender(cellElement({ ...props, ...next })),
  };
}
const gridCell = () => screen.getByRole("gridcell");
/** A click selects a cell; a double click swaps in the editor. */
function openCell(name = "Company") {
  fireEvent.doubleClick(gridCell());
  return screen.getByRole("textbox", { name });
}

describe("table cell editing", () => {
  it("retains the version at edit start when live updates arrive", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { rerenderCell } = renderCell({ onSave: save });
    const input = openCell();
    fireEvent.change(input, { target: { value: "My draft" } });
    rerenderCell({
      row: { ...row, version: 2, values: { [column.id]: "Remote edit" } },
    });
    expect(input).toHaveValue("My draft");
    fireEvent.blur(input);
    await waitFor(() => expect(save).toHaveBeenCalledWith(1, "My draft"));
  });
  it("shows a conflict and preserves the draft for review", async () => {
    const save = vi.fn().mockRejectedValue(new Error("Row changed"));
    renderCell({ onSave: save });
    const input = openCell();
    fireEvent.change(input, { target: { value: "Keep me" } });
    fireEvent.blur(input);
    expect(await screen.findByRole("alert")).toHaveTextContent("Row changed");
    expect(input).toHaveValue("Keep me");
  });
  it("sizes the editor like every other form control", () => {
    renderCell();
    // Rule 6 of .cursor/rules/dynamic-type.mdc: focusable editables are pure
    // rem via withEditableTextSize, and form controls share the h-10 height.
    const control = openCell();
    expect(control).toHaveClass("text-base", "md:text-sm", "h-10");
    expect(control.className).not.toMatch(/(^|\s)text-sm(\s|$)/);
  });
  it("cancels a draft with Escape without saving and keeps the cell selected", () => {
    const save = vi.fn();
    renderCell({ onSave: save, active: true });
    const input = openCell();
    fireEvent.change(input, { target: { value: "Discard" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(save).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("Original")).toBeInTheDocument();
    expect(gridCell()).toHaveFocus();
    expect(gridCell()).toHaveAttribute("aria-selected", "true");
  });
  it("commits with Enter and moves the selection down", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const onNavigate = vi.fn(() => true);
    renderCell({ onSave: save, onNavigate });
    const input = openCell();
    fireEvent.change(input, { target: { value: "Saved" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onNavigate).toHaveBeenCalledWith("down");
    fireEvent.blur(input);
    await waitFor(() => expect(save).toHaveBeenCalledWith(1, "Saved"));
    expect(save).toHaveBeenCalledOnce();
  });
  it("commits with Tab and moves right, Shift+Tab left", () => {
    const onNavigate = vi.fn(() => true);
    renderCell({ onNavigate });
    fireEvent.keyDown(openCell(), { key: "Tab" });
    expect(onNavigate).toHaveBeenLastCalledWith("right");
    fireEvent.keyDown(screen.getByRole("textbox"), {
      key: "Tab",
      shiftKey: true,
    });
    expect(onNavigate).toHaveBeenLastCalledWith("left");
  });
});

describe("table cell selection", () => {
  it("reads as text; focus selects it and a single click does not edit", () => {
    const onActivate = vi.fn();
    renderCell({ onActivate });
    expect(screen.getByText("Original")).toBeInTheDocument();
    fireEvent.focus(gridCell());
    fireEvent.click(gridCell());
    expect(onActivate).toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
  it("draws the selection ring only on the selected cell", () => {
    // `outline-none` beside the ring classes computes `outline-style: none`
    // and erased the ring, so the two never share a cell.
    const { rerenderCell } = renderCell({ active: true });
    expect(gridCell()).toHaveClass("outline-2", "outline-ring");
    expect(gridCell()).not.toHaveClass("outline-none");
    rerenderCell({ active: false });
    expect(gridCell()).toHaveClass("outline-none");
    expect(gridCell()).not.toHaveClass("outline-ring");
  });
  it("opens the editor with Enter or F2, keeping the value", () => {
    renderCell({ active: true });
    fireEvent.keyDown(gridCell(), { key: "Enter" });
    expect(screen.getByRole("textbox", { name: "Company" })).toHaveValue(
      "Original",
    );
    expect(screen.getByRole("textbox")).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    fireEvent.keyDown(gridCell(), { key: "F2" });
    expect(screen.getByRole("textbox")).toHaveValue("Original");
  });
  it("starts editing with a typed character that replaces the value", () => {
    renderCell({ active: true });
    fireEvent.keyDown(gridCell(), { key: "x" });
    expect(screen.getByRole("textbox", { name: "Company" })).toHaveValue("x");
  });
  it("moves the selection with the arrow keys and Tab", () => {
    const onNavigate = vi.fn((_move: GridMove) => true);
    renderCell({ active: true, onNavigate });
    for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"])
      fireEvent.keyDown(gridCell(), { key });
    fireEvent.keyDown(gridCell(), { key: "Tab" });
    fireEvent.keyDown(gridCell(), { key: "Tab", shiftKey: true });
    expect(onNavigate.mock.calls.map(([move]) => move)).toEqual([
      "up",
      "down",
      "left",
      "right",
      "right",
      "left",
    ]);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
  it("copies the cell text with Cmd/Ctrl+C", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    renderCell({ active: true });
    fireEvent.keyDown(gridCell(), { key: "c", metaKey: true });
    expect(writeText).toHaveBeenCalledWith("Original");
  });
  it("saves pasted text through the same parse and save path", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    renderCell({ active: true, onSave: save });
    fireEvent.paste(gridCell(), {
      clipboardData: { getData: () => "Pasted\n" },
    });
    await waitFor(() => expect(save).toHaveBeenCalledWith(1, "Pasted"));
  });
  it("shows a pasted value that fails validation like a typed one", async () => {
    const save = vi.fn();
    const score = { ...column, name: "Score", type: "number" as const };
    renderCell({ column: score, active: true, onSave: save });
    fireEvent.paste(gridCell(), {
      clipboardData: { getData: () => "not a number" },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("errors.number");
    expect(save).not.toHaveBeenCalled();
  });
  it("does not open the editor on a disabled cell", () => {
    renderCell({ disabled: true, active: true });
    fireEvent.doubleClick(gridCell());
    fireEvent.keyDown(gridCell(), { key: "Enter" });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(gridCell()).toHaveAttribute("aria-readonly", "true");
  });
});

describe("table cell read mode", () => {
  it("formats dates, links and options for reading", () => {
    const date = { ...column, id: "d", name: "Met", type: "date" as const };
    const url = { ...column, id: "u", name: "Site", type: "url" as const };
    const email = { ...column, id: "e", name: "Mail", type: "email" as const };
    const tags = {
      ...column,
      id: "t",
      name: "Tags",
      type: "multiple_select" as const,
      options: ["Partner", "Investor"],
    };
    const values = {
      d: "2024-04-30",
      u: "https://www.linkedin.com/in/ada/",
      e: "ada@example.com",
      t: ["Partner", "Investor"],
    };
    for (const item of [date, url, email, tags])
      renderCell({ column: item, row: { ...row, values } });
    expect(screen.getByText("30 Apr 2024")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "linkedin.com/in/ada" });
    expect(link).toHaveAttribute("href", values.u);
    expect(link).toHaveAttribute("target", "_blank");
    expect(
      screen.getByRole("link", { name: "ada@example.com" }),
    ).toHaveAttribute("href", "mailto:ada@example.com");
    // The open-link button is the pointer path only: hidden from the
    // accessibility tree, where Alt+Enter on the cell does the same.
    expect(screen.queryByRole("link", { name: "openLink" })).toBeNull();
    expect(
      screen.getAllByRole("link", { name: "openLink", hidden: true })[0],
    ).toHaveAttribute("href", values.u);
    expect(screen.getByText("Partner")).toBeInTheDocument();
    expect(screen.getByText("Investor")).toBeInTheDocument();
  });
  it("selects instead of following a plain click on a link", () => {
    const site = { ...column, name: "Site", type: "url" as const };
    renderCell({
      column: site,
      row: { ...row, values: { [column.id]: "https://example.com" } },
    });
    const link = screen.getByRole("link", { name: "example.com" });
    expect(fireEvent.click(link)).toBe(false);
    expect(fireEvent.click(link, { metaKey: true })).toBe(true);
  });
  it("clips by default, clamps long text and wraps when the column says so", () => {
    const long = "A long note\nwith a second line";
    const notes = { ...column, type: "long_text" as const };
    const { rerenderCell } = renderCell({
      row: { ...row, values: { [column.id]: long } },
    });
    expect(screen.getByText(long, { normalizer: (text) => text })).toHaveClass(
      "truncate",
    );
    rerenderCell({ column: notes });
    expect(screen.getByText(long, { normalizer: (text) => text })).toHaveClass(
      "line-clamp-2",
    );
    rerenderCell({ column: { ...notes, wrap: true } });
    const wrapped = screen.getByText(long, { normalizer: (text) => text });
    expect(wrapped).toHaveClass("whitespace-pre-line");
    expect(wrapped).not.toHaveClass("line-clamp-2");
    rerenderCell({ column: { ...notes, wrap: false } });
    expect(screen.getByText(long, { normalizer: (text) => text })).toHaveClass(
      "truncate",
    );
  });
  it("saves a select as soon as an option is chosen", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const stage = {
      ...column,
      name: "Stage",
      type: "single_select" as const,
      options: ["Contacted"],
    };
    renderCell({ column: stage, row: { ...row, values: {} }, onSave: save });
    fireEvent.doubleClick(gridCell());
    fireEvent.change(screen.getByRole("combobox", { name: "Stage" }), {
      target: { value: "Contacted" },
    });
    await waitFor(() => expect(save).toHaveBeenCalledWith(1, "Contacted"));
    expect(save).toHaveBeenCalledOnce();
  });
  it("toggles a checkbox inline and with Space", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const done = { ...column, name: "Done", type: "checkbox" as const };
    renderCell({ column: done, row: { ...row, values: {} }, onSave: save });
    fireEvent.click(screen.getByRole("checkbox", { name: "Done" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(1, true));
    fireEvent.keyDown(gridCell(), { key: " " });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  });
});

describe("last updated cell", () => {
  it("is a selectable, copyable, read-only time with no editor", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const onNavigate = vi.fn(() => true);
    const updatedAt = new Date("2020-03-04T05:06:07.000Z");
    render(
      <table>
        <tbody>
          <tr>
            <TableUpdatedCell
              id="updated"
              columnId="c"
              row={{ ...row, updatedAt }}
              active
              tabbable
              onActivate={() => {}}
              onNavigate={onNavigate}
            />
          </tr>
        </tbody>
      </table>,
    );
    const time = screen.getByText("dateTimeWithYear:2020-03-04T05:06:07.000Z");
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("dateTime", "2020-03-04T05:06:07.000Z");
    const cell = gridCell();
    expect(cell).toHaveAttribute("aria-readonly", "true");
    fireEvent.keyDown(cell, { key: "Enter" });
    fireEvent.doubleClick(cell);
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.keyDown(cell, { key: "ArrowRight" });
    expect(onNavigate).toHaveBeenCalledWith("right");
    fireEvent.keyDown(cell, { key: "c", ctrlKey: true });
    expect(writeText).toHaveBeenCalledWith(
      "dateTimeWithYear:2020-03-04T05:06:07.000Z",
    );
  });
});
