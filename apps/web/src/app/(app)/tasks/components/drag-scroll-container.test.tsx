import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DragScrollContainer } from "./drag-scroll-container";

function renderBoard() {
  render(
    <DragScrollContainer>
      <section data-column-id="backlog" />
      <section data-column-id="input-required" />
    </DragScrollContainer>,
  );
}

describe("DragScrollContainer", () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState(null, "", "/");
    vi.restoreAllMocks();
  });

  it("opens on the column the URL hash names", () => {
    const scrolled: Element[] = [];
    vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (
      this: Element,
    ) {
      scrolled.push(this);
    });
    window.history.replaceState(null, "", "/tasks#input-required");
    renderBoard();
    expect(scrolled.map((el) => el.getAttribute("data-column-id"))).toEqual([
      "input-required",
    ]);
  });

  it("stays put without a hash", () => {
    const scrollIntoView = vi
      .spyOn(Element.prototype, "scrollIntoView")
      .mockImplementation(() => {});
    window.history.replaceState(null, "", "/tasks");
    renderBoard();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
