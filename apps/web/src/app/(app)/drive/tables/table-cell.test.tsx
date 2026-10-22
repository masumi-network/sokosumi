import type { TableColumn, TableRow } from "@sokosumi/core-client";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
/** Cells read as text until clicked; the click swaps in the editor. */
function openCell(name = "Company") {
  fireEvent.click(screen.getByRole("button", { name: "editCell" }));
  return screen.getByRole("textbox", { name });
}
function renderCell(
  props: Partial<React.ComponentProps<typeof TableCell>> = {},
) {
  return render(
    <TableCell
      column={column}
      row={row}
      disabled={false}
      onSave={vi.fn()}
      onHistory={() => {}}
      {...props}
    />,
  );
}
const column: TableColumn = {
  id: "00000000-0000-4000-8000-000000000001",
  tableId: "00000000-0000-4000-8000-000000000002",
  name: "Company",
  description: "",
  type: "text",
  options: [],
  position: 0,
  version: 1,
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
describe("table cell editing", () => {
  it("retains the version at edit start when live updates arrive", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <TableCell
        column={column}
        row={row}
        disabled={false}
        onSave={save}
        onHistory={() => {}}
      />,
    );
    const input = openCell();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "My draft" } });
    rerender(
      <TableCell
        column={column}
        row={{ ...row, version: 2, values: { [column.id]: "Remote edit" } }}
        disabled={false}
        onSave={save}
        onHistory={() => {}}
      />,
    );
    expect(input).toHaveValue("My draft");
    fireEvent.blur(input);
    await waitFor(() => expect(save).toHaveBeenCalledWith(1, "My draft"));
  });
  it("shows a conflict and preserves the draft for review", async () => {
    const save = vi.fn().mockRejectedValue(new Error("Row changed"));
    render(
      <TableCell
        column={column}
        row={row}
        disabled={false}
        onSave={save}
        onHistory={() => {}}
      />,
    );
    const input = openCell();
    fireEvent.focus(input);
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
  it("cancels a draft with Escape without saving", () => {
    const save = vi.fn();
    render(
      <TableCell
        column={column}
        row={row}
        disabled={false}
        onSave={save}
        onHistory={() => {}}
      />,
    );
    const input = openCell();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Discard" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(save).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("Original")).toBeInTheDocument();
  });
});
describe("table cell read mode", () => {
  it("reads as text and opens the focused editor on click", () => {
    renderCell();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("Original")).toBeInTheDocument();
    expect(openCell()).toHaveFocus();
  });
  it("commits with Enter, returns to read mode and refocuses the cell", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    renderCell({ onSave: save });
    const input = openCell();
    fireEvent.change(input, { target: { value: "Saved" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    await waitFor(() => expect(save).toHaveBeenCalledWith(1, "Saved"));
    expect(save).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "editCell" })).toHaveFocus(),
    );
  });
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
    expect(screen.getByText("Partner")).toBeInTheDocument();
    expect(screen.getByText("Investor")).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "editCell" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Stage" }), {
      target: { value: "Contacted" },
    });
    await waitFor(() => expect(save).toHaveBeenCalledWith(1, "Contacted"));
    expect(save).toHaveBeenCalledOnce();
  });
  it("toggles a checkbox inline", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const done = { ...column, name: "Done", type: "checkbox" as const };
    renderCell({ column: done, row: { ...row, values: {} }, onSave: save });
    fireEvent.click(screen.getByRole("checkbox", { name: "Done" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(1, true));
  });
  it("does not open the editor on a disabled cell", () => {
    renderCell({ disabled: true });
    expect(screen.getByRole("button", { name: "editCell" })).toBeDisabled();
  });
  it("shows Last updated as a read-only time with no editor", () => {
    const updatedAt = new Date("2020-03-04T05:06:07.000Z");
    render(<TableUpdatedCell row={{ ...row, updatedAt }} />);
    const time = screen.getByText("dateTimeWithYear:2020-03-04T05:06:07.000Z");
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("dateTime", "2020-03-04T05:06:07.000Z");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
