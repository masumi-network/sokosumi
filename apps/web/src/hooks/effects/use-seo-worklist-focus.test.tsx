import { render, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { useSeoWorklistFocus } from "./use-seo-worklist-focus";

function WorklistHarness({
  focusStrategy,
  onFocusHandled,
  showFilters = true,
  showSecondFilter = true,
  showStrategyRow = true,
  showSummaryRow = false,
}: {
  focusStrategy: boolean;
  onFocusHandled: () => void;
  showFilters?: boolean;
  showSecondFilter?: boolean;
  showStrategyRow?: boolean;
  showSummaryRow?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const filterLine = useRef<HTMLFieldSetElement>(null);
  const list = useRef<HTMLUListElement>(null);
  useSeoWorklistFocus(root, filterLine, list, focusStrategy, onFocusHandled);
  return (
    <div>
      <button type="button">Outside</button>
      <div ref={root}>
        {showFilters ? (
          <fieldset ref={filterLine}>
            <button type="button">All</button>
            {showSecondFilter ? <button type="button">Low</button> : null}
          </fieldset>
        ) : null}
        <ul ref={list}>
          {showSummaryRow ? (
            <li>
              <details>
                <summary>Evidence item</summary>
              </details>
            </li>
          ) : (
            <li>
              <button type="button">First action</button>
            </li>
          )}
          {showStrategyRow ? (
            <li data-strategy-row>
              <button type="button">Strategy action</button>
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}

describe("useSeoWorklistFocus", () => {
  it("focuses the strategy row and invokes onFocusHandled with no arguments", () => {
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
    const onFocusHandled = vi.fn();

    try {
      const { rerender } = render(
        <WorklistHarness
          focusStrategy={false}
          onFocusHandled={onFocusHandled}
        />,
      );
      expect(onFocusHandled).not.toHaveBeenCalled();

      rerender(
        <WorklistHarness
          focusStrategy={true}
          onFocusHandled={onFocusHandled}
        />,
      );
      const strategyButton = screen.getByRole("button", {
        name: "Strategy action",
      });
      expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({
        block: "nearest",
      });
      expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
      expect(strategyButton).toHaveFocus();
      expect(onFocusHandled).toHaveBeenCalledExactlyOnceWith();
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it("still invokes onFocusHandled when focusStrategy is true without a strategy row", () => {
    const onFocusHandled = vi.fn();

    render(
      <WorklistHarness
        focusStrategy={true}
        onFocusHandled={onFocusHandled}
        showStrategyRow={false}
      />,
    );

    expect(onFocusHandled).toHaveBeenCalledExactlyOnceWith();
  });

  it("recovers lost focus to the filter line or first row without calling onFocusHandled", () => {
    const onFocusHandled = vi.fn();
    const { rerender } = render(
      <WorklistHarness focusStrategy={false} onFocusHandled={onFocusHandled} />,
    );

    // Focus inside the filter line on a control that disappears -> moves to All.
    screen.getByRole("button", { name: "Low" }).focus();
    rerender(
      <WorklistHarness
        focusStrategy={false}
        onFocusHandled={onFocusHandled}
        showSecondFilter={false}
      />,
    );
    expect(screen.getByRole("button", { name: "All" })).toHaveFocus();
    expect(onFocusHandled).not.toHaveBeenCalled();

    // Whole filter line disappears while All has focus -> moves to first list control.
    rerender(
      <WorklistHarness
        focusStrategy={false}
        onFocusHandled={onFocusHandled}
        showFilters={false}
        showSummaryRow={true}
      />,
    );
    expect(screen.getByText("Evidence item")).toHaveFocus();
    expect(onFocusHandled).not.toHaveBeenCalled();
  });

  it("leaves focus alone when focus was outside the worklist", () => {
    const onFocusHandled = vi.fn();
    const { rerender } = render(
      <WorklistHarness focusStrategy={false} onFocusHandled={onFocusHandled} />,
    );

    const outside = screen.getByRole("button", { name: "Outside" });
    outside.focus();
    rerender(
      <WorklistHarness
        focusStrategy={false}
        onFocusHandled={onFocusHandled}
        showFilters={false}
      />,
    );
    expect(outside).toHaveFocus();
    expect(onFocusHandled).not.toHaveBeenCalled();
  });
});
