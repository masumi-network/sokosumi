import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TableColumn, TableRow } from "@/lib/clients/generated/core";
import { TableCell } from "./table-cell";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
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
    const input = screen.getByRole("textbox", { name: "Company" });
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
    const input = screen.getByRole("textbox", { name: "Company" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Keep me" } });
    fireEvent.blur(input);
    expect(await screen.findByRole("alert")).toHaveTextContent("Row changed");
    expect(input).toHaveValue("Keep me");
  });
  it("sizes a select cell like the text cell it sits beside", () => {
    const select: TableColumn = {
      ...column,
      id: "00000000-0000-4000-8000-000000000004",
      name: "Stage",
      type: "single_select",
      options: ["Contacted"],
    };
    render(
      <>
        <TableCell
          column={column}
          row={row}
          disabled={false}
          onSave={vi.fn()}
          onHistory={() => {}}
        />
        <TableCell
          column={select}
          row={{ ...row, values: {} }}
          disabled={false}
          onSave={vi.fn()}
          onHistory={() => {}}
        />
      </>,
    );
    // Rule 6 of .cursor/rules/dynamic-type.mdc: focusable editables are pure
    // rem via withEditableTextSize, and form controls share the h-10 height.
    for (const control of [
      screen.getByRole("textbox", { name: "Company" }),
      screen.getByRole("combobox", { name: "Stage" }),
    ]) {
      expect(control).toHaveClass("text-base", "md:text-sm", "h-10");
      expect(control.className).not.toMatch(/(^|\s)text-sm(\s|$)/);
    }
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
    const input = screen.getByRole("textbox", { name: "Company" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Discard" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);
    expect(save).not.toHaveBeenCalled();
    expect(input).toHaveValue("Original");
  });
});
