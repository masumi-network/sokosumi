import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { handleGridKey } from "./grid-keys";
import { useGridFocus } from "./use-grid-focus";

const ROWS = ["r1", "r2"];
const COLUMNS = ["a", "b"];

function Grid() {
  const { cellProps } = useGridFocus(ROWS, COLUMNS);
  return (
    <table>
      <tbody>
        {ROWS.map((row, rowIndex) => (
          <tr key={row}>
            {COLUMNS.map((column, columnIndex) => {
              const cell = cellProps(rowIndex, columnIndex);
              return (
                <td
                  key={column}
                  id={cell.id}
                  role="gridcell"
                  aria-label={`${row}-${column}`}
                  aria-selected={cell.active}
                  tabIndex={cell.tabbable ? 0 : -1}
                  onFocus={cell.onActivate}
                  onKeyDown={(event) =>
                    handleGridKey(event, `${row}-${column}`, cell.onNavigate)
                  }
                />
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

describe("useGridFocus", () => {
  it("makes the first cell the only tab stop until one is selected", () => {
    render(<Grid />);
    const tabbable = screen
      .getAllByRole("gridcell")
      .filter((cell) => cell.tabIndex === 0);
    expect(tabbable.map((cell) => cell.getAttribute("aria-label"))).toEqual([
      "r1-a",
    ]);
  });

  it("moves the selection with the arrow keys and stops at the edges", () => {
    render(<Grid />);
    const first = screen.getByRole("gridcell", { name: "r1-a" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    const right = screen.getByRole("gridcell", { name: "r1-b" });
    expect(document.activeElement).toBe(right);
    expect(right).toHaveAttribute("aria-selected", "true");
    expect(right.tabIndex).toBe(0);
    fireEvent.keyDown(right, { key: "ArrowDown" });
    expect(document.activeElement).toBe(
      screen.getByRole("gridcell", { name: "r2-b" }),
    );
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowRight" });
    expect(document.activeElement).toBe(
      screen.getByRole("gridcell", { name: "r2-b" }),
    );
  });
});
