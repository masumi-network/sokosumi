import { describe, expect, it, vi } from "vitest";
import { resetBrowserState } from "./setup.dom";

describe("resetBrowserState document listener and selection cleanup", () => {
  it("removes document listeners whose deferred cleanup timer is aborted by happyDOM.abort()", async () => {
    const removeSelection = vi.fn(() => {
      document.getSelection()?.removeAllRanges();
    });
    const stopClick = vi.fn((event: Event) => {
      event.stopPropagation();
    });

    document.addEventListener("selectionchange", removeSelection);
    document.addEventListener("click", stopClick, { capture: true });

    // Mirrors @dnd-kit/core AbstractPointerSensor.detach(), which delays
    // removing its document listeners by 50ms.
    window.setTimeout(() => {
      document.removeEventListener("selectionchange", removeSelection);
      document.removeEventListener("click", stopClick, { capture: true });
    }, 50);

    await resetBrowserState();

    const root = document.createElement("div");
    const text = document.createTextNode("_asds_");
    root.appendChild(text);
    document.body.appendChild(root);

    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(text, 6);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(selection?.rangeCount).toBe(1);
    expect(removeSelection).not.toHaveBeenCalled();

    const button = document.createElement("button");
    const onClick = vi.fn();
    button.addEventListener("click", onClick);
    document.body.appendChild(button);
    button.click();

    expect(stopClick).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("clears any leftover selection ranges between files", async () => {
    const root = document.createElement("div");
    const text = document.createTextNode("leftover");
    root.appendChild(text);
    document.body.appendChild(root);

    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 4);
    selection?.removeAllRanges();
    selection?.addRange(range);
    expect(selection?.rangeCount).toBe(1);

    await resetBrowserState();

    expect(window.getSelection()?.rangeCount).toBe(0);
  });
});
