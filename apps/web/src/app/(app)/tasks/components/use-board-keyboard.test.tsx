import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { boardFocusTarget, useBoardKeyboard } from "./use-board-keyboard";

const openNewTaskMock = vi.fn();
let canCreate = true;

vi.mock("@/app/components/new-task-button.client", () => ({
  useNewTaskOpener: () => (canCreate ? openNewTaskMock : null),
}));

function Card({ name }: { name: string }) {
  return (
    // Mirrors the drag wrapper dnd-kit puts around a card.
    <div role="button" tabIndex={0} data-testid={`wrapper-${name}`}>
      <article>
        <h3>
          <a href={`/tasks/${name}`}>{name}</a>
        </h3>
      </article>
    </div>
  );
}

/** Three columns: two cards, none, one card. */
function Board() {
  useBoardKeyboard();
  return (
    <>
      <input aria-label="Search" />
      <section data-column-id="backlog">
        <Card name="a1" />
        <Card name="a2" />
      </section>
      <section data-column-id="todo" />
      <section data-column-id="done">
        <Card name="c1" />
      </section>
      <div role="dialog">
        <button type="button">In dialog</button>
      </div>
    </>
  );
}

const link = (name: string) => screen.getByRole("link", { name });

describe("boardFocusTarget", () => {
  beforeEach(() => {
    render(<Board />);
  });

  it("moves down and up inside a column and stops at its ends", () => {
    expect(boardFocusTarget("ArrowDown", link("a1"))).toBe(link("a2"));
    expect(boardFocusTarget("ArrowUp", link("a2"))).toBe(link("a1"));
    expect(boardFocusTarget("ArrowDown", link("a2"))).toBeNull();
    expect(boardFocusTarget("ArrowUp", link("a1"))).toBeNull();
  });

  it("skips an empty column and lands on the last card of a shorter one", () => {
    expect(boardFocusTarget("ArrowRight", link("a2"))).toBe(link("c1"));
    expect(boardFocusTarget("ArrowLeft", link("c1"))).toBe(link("a1"));
    expect(boardFocusTarget("ArrowRight", link("c1"))).toBeNull();
  });

  it("starts from the drag wrapper around a card as well", () => {
    expect(
      boardFocusTarget("ArrowDown", screen.getByTestId("wrapper-a1")),
    ).toBe(link("a2"));
  });

  it("leaves the arrows alone when no card has the focus", () => {
    expect(boardFocusTarget("ArrowDown", document.body)).toBeNull();
    expect(boardFocusTarget("ArrowDown", null)).toBeNull();
  });
});

describe("useBoardKeyboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canCreate = true;
  });

  it("moves the focus with an arrow and keeps the page from scrolling", () => {
    render(<Board />);
    link("a1").focus();
    const moved = !fireEvent.keyDown(link("a1"), { key: "ArrowDown" });

    expect(document.activeElement).toBe(link("a2"));
    expect(moved).toBe(true);
  });

  it("opens the New Task wizard on c", () => {
    render(<Board />);
    fireEvent.keyDown(document.body, { key: "c" });

    expect(openNewTaskMock).toHaveBeenCalledOnce();
  });

  it("leaves c to a field, a dialog, a shortcut with a modifier and a composition", () => {
    render(<Board />);
    fireEvent.keyDown(screen.getByLabelText("Search"), { key: "c" });
    fireEvent.keyDown(screen.getByRole("button", { name: "In dialog" }), {
      key: "c",
    });
    fireEvent.keyDown(document.body, { key: "c", metaKey: true });
    fireEvent.keyDown(document.body, { key: "c", isComposing: true });

    expect(openNewTaskMock).not.toHaveBeenCalled();
  });

  it("does nothing on c for a reader who cannot create a Task", () => {
    canCreate = false;
    render(<Board />);
    const handled = !fireEvent.keyDown(document.body, { key: "c" });

    expect(handled).toBe(false);
  });
});
