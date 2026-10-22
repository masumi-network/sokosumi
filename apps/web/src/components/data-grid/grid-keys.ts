import type { KeyboardEvent } from "react";

export type GridMove = "up" | "down" | "left" | "right";

/** Where the selection sits in the grid, and how it moves. */
export interface GridCellProps {
  id: string;
  active: boolean;
  /** The one cell in the tab order: the active one, or the first. */
  tabbable: boolean;
  className?: string;
  onActivate: () => void;
  /** Moves the selection and focus; false when there is no cell that way. */
  onNavigate: (move: GridMove) => boolean;
}

const ARROW_MOVES: Record<string, GridMove> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

function hasTextSelection() {
  const selection = window.getSelection();
  return !!selection && !selection.isCollapsed;
}

/**
 * The keys every cell shares: arrows and Tab move the selection, and
 * Cmd/Ctrl+C copies the cell's text. True when the key was handled.
 */
export function handleGridKey(
  event: KeyboardEvent<HTMLElement>,
  text: string,
  onNavigate: (move: GridMove) => boolean,
): boolean {
  const modified = event.altKey || event.metaKey || event.ctrlKey;
  const move =
    event.key === "Tab"
      ? event.shiftKey
        ? "left"
        : "right"
      : ARROW_MOVES[event.key];
  if (move && !modified) {
    // Tab past the last cell leaves the grid, so it never traps focus.
    if (onNavigate(move) || event.key !== "Tab") event.preventDefault();
    return true;
  }
  if (
    (event.metaKey || event.ctrlKey) &&
    event.key.toLowerCase() === "c" &&
    !hasTextSelection()
  ) {
    event.preventDefault();
    void navigator.clipboard?.writeText(text);
    return true;
  }
  return false;
}
