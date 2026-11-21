import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardEdgeShortcuts } from "./board-edge-shortcuts";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

const columns = [
  { id: "todo", title: "Todo", count: 0, statusColor: "bg-muted" },
  { id: "inProgress", title: "In progress", count: 2, statusColor: "bg-muted" },
  { id: "done", title: "Done", count: 1, statusColor: "bg-muted" },
] as const;

// The scroller shows 0–1000px; each column is 400px wide from `left`.
const lefts = { todo: 0, inProgress: 800, done: 1200 };

function rect(left: number, width: number) {
  return { left, right: left + width, width } as DOMRect;
}

function Board() {
  return (
    <div data-testid="scroller">
      {columns.map((column) => (
        <section
          key={column.id}
          data-column-id={column.id}
          aria-label={column.title}
          tabIndex={-1}
        />
      ))}
      <BoardEdgeShortcuts columns={[...columns]} />
    </div>
  );
}

function layOut(scroller: HTMLElement, scrollLeft = 0) {
  scroller.scrollLeft = scrollLeft;
  vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(rect(0, 1000));
  vi.spyOn(scroller, "clientWidth", "get").mockReturnValue(1000);
  for (const section of scroller.querySelectorAll("section")) {
    const id = section.dataset.columnId as keyof typeof lefts;
    vi.spyOn(section, "getBoundingClientRect").mockImplementation(() =>
      rect(lefts[id] - scroller.scrollLeft, 400),
    );
  }
}

afterEach(() => vi.restoreAllMocks());

describe("BoardEdgeShortcuts", () => {
  it("names only the columns wholly past the right edge, with their counts", () => {
    const { rerender } = render(<Board />);
    layOut(screen.getByTestId("scroller"));
    rerender(<Board />);
    act(() => {
      fireEvent.scroll(screen.getByTestId("scroller"));
    });
    const nav = screen.getByRole("navigation", { name: "label" });
    const buttons = Array.from(nav.querySelectorAll("button"));
    expect(buttons.map((button) => button.textContent)).toEqual([
      'Donecount {"count":1}1',
    ]);
  });

  it("scrolls the board to the column and focuses it", () => {
    const { rerender } = render(<Board />);
    const scroller = screen.getByTestId("scroller");
    layOut(scroller);
    rerender(<Board />);
    act(() => {
      fireEvent.scroll(scroller);
    });
    const scrollTo = vi.fn((options: ScrollToOptions) => {
      scroller.scrollLeft = options.left ?? 0;
      fireEvent.scroll(scroller);
    });
    scroller.scrollTo = scrollTo as unknown as typeof scroller.scrollTo;
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Done/ }));
    });
    expect(scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ left: 1200 - 8 }),
    );
    expect(document.activeElement).toBe(
      screen.getByRole("region", { name: "Done" }),
    );
    // Nothing is past the edge any more.
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("shows nothing before the board has a width", () => {
    render(<Board />);
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });
});
