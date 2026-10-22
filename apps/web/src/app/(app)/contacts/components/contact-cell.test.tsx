import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type CellEdit, ContactCell } from "./contact-cell";

function renderCell(props: {
  edit?: CellEdit;
  onOpen?: () => void;
  onNavigate?: () => boolean;
}) {
  render(
    <table>
      <tbody>
        <tr>
          <ContactCell
            id="cell"
            active
            tabbable
            onActivate={() => {}}
            onNavigate={props.onNavigate ?? (() => true)}
            columnId="organization"
            label="Organization"
            text="Lumen AI"
            edit={props.edit}
            onOpen={props.onOpen}
          >
            Lumen AI
          </ContactCell>
        </tr>
      </tbody>
    </table>,
  );
  return screen.getByRole("gridcell");
}

describe("ContactCell", () => {
  it("replaces the value with a typed character and saves on Enter, moving down", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const onNavigate = vi.fn(() => true);
    const cell = renderCell({
      edit: { kind: "text", value: "Lumen AI", onSave },
      onNavigate,
    });
    fireEvent.keyDown(cell, { key: "N" });
    const input = screen.getByRole("textbox", { name: "Organization" });
    expect(input).toHaveValue("N");
    fireEvent.change(input, { target: { value: "Northwind" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("Northwind"));
    expect(onNavigate).toHaveBeenCalledWith("down");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("cancels on Escape without saving", () => {
    const onSave = vi.fn();
    const cell = renderCell({
      edit: { kind: "text", value: "Lumen AI", onSave },
    });
    fireEvent.keyDown(cell, { key: "Enter" });
    const input = screen.getByRole("textbox", { name: "Organization" });
    expect(input).toHaveValue("Lumen AI");
    fireEvent.change(input, { target: { value: "Other" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("opens the person on Enter when the cell has one, and is read-only without an edit", () => {
    const onOpen = vi.fn();
    const cell = renderCell({ onOpen });
    expect(cell).toHaveAttribute("aria-readonly", "true");
    fireEvent.keyDown(cell, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("moves with the arrow keys", () => {
    const onNavigate = vi.fn(() => true);
    const cell = renderCell({ onNavigate });
    fireEvent.keyDown(cell, { key: "ArrowRight" });
    expect(onNavigate).toHaveBeenCalledWith("right");
  });
});
