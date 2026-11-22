import { act, render, screen } from "@testing-library/react";
import { Activity, StrictMode, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useMarkdownEditorSelectionToolbar } from "./use-markdown-editor-selection-toolbar";

const SAMPLE_RECT = {
  x: 40,
  y: 40,
  top: 40,
  left: 40,
  width: 80,
  height: 16,
  bottom: 56,
  right: 120,
  toJSON() {
    return this;
  },
} as DOMRect;

function selectAllIn(element: HTMLElement) {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

describe("useMarkdownEditorSelectionToolbar", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.getSelection()?.removeAllRanges();
  });

  it("tracks document selectionchange, rebinds when saveSelectionRange changes between events, and clears when leaving document variant", () => {
    vi.spyOn(Range.prototype, "getBoundingClientRect").mockReturnValue(
      SAMPLE_RECT,
    );
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");

    const saveA = vi.fn();
    const saveB = vi.fn();
    const captured: {
      rect: DOMRect | null;
      savedRange: Range | null;
    } = { rect: null, savedRange: null };

    const hookListeners = new Set<EventListener>();
    const hookSelectionAdds = () =>
      addSpy.mock.calls.filter(
        ([event, listener]) =>
          event === "selectionchange" &&
          typeof listener === "function" &&
          hookListeners.has(listener),
      );
    const hookSelectionRemoves = () =>
      removeSpy.mock.calls.filter(
        ([event, listener]) =>
          event === "selectionchange" &&
          typeof listener === "function" &&
          hookListeners.has(listener),
      );

    function Probe({
      variant,
      saveSelectionRange,
    }: {
      variant: "field" | "document";
      saveSelectionRange: () => void;
    }) {
      const editorRef = useRef<HTMLDivElement>(null);
      const savedSelectionRangeRef = useRef<Range | null>(null);
      const { selectionRect, updateSelectionToolbar } =
        useMarkdownEditorSelectionToolbar({
          editorRef,
          savedSelectionRangeRef,
          saveSelectionRange,
          variant,
        });
      hookListeners.add(updateSelectionToolbar);
      captured.rect = selectionRect;
      captured.savedRange = savedSelectionRangeRef.current;
      return (
        <div
          ref={editorRef}
          data-testid="editor"
          contentEditable
          suppressContentEditableWarning
        >
          Hello world
        </div>
      );
    }

    const { rerender, unmount } = render(
      <Probe variant="field" saveSelectionRange={saveA} />,
    );
    expect(hookSelectionAdds()).toHaveLength(0);
    expect(captured.rect).toBeNull();

    rerender(<Probe variant="document" saveSelectionRange={saveA} />);
    expect(hookSelectionAdds()).toHaveLength(1);

    const editor = screen.getByTestId("editor");
    act(() => {
      selectAllIn(editor);
    });
    expect(captured.rect).toBe(SAMPLE_RECT);
    expect(saveA).toHaveBeenCalledTimes(1);
    expect(saveB).not.toHaveBeenCalled();

    // Changing saveSelectionRange between events must rebind the listener to the new callback.
    rerender(<Probe variant="document" saveSelectionRange={saveB} />);
    expect(hookSelectionRemoves()).toHaveLength(1);
    expect(hookSelectionAdds()).toHaveLength(2);

    act(() => {
      document.dispatchEvent(new Event("selectionchange"));
    });
    expect(saveA).toHaveBeenCalledTimes(1);
    expect(saveB).toHaveBeenCalledTimes(1);

    // Switching back to field variant detaches listener and clears selectionRect.
    rerender(<Probe variant="field" saveSelectionRange={saveB} />);
    expect(hookSelectionRemoves()).toHaveLength(2);
    expect(captured.rect).toBeNull();

    unmount();
  });

  it("matches StrictMode replay and detaches selectionchange while hidden under Activity", () => {
    vi.spyOn(Range.prototype, "getBoundingClientRect").mockReturnValue(
      SAMPLE_RECT,
    );
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const save = vi.fn();
    const hookListeners = new Set<EventListener>();
    const hookSelectionAdds = () =>
      addSpy.mock.calls.filter(
        ([event, listener]) =>
          event === "selectionchange" &&
          typeof listener === "function" &&
          hookListeners.has(listener),
      );
    const hookSelectionRemoves = () =>
      removeSpy.mock.calls.filter(
        ([event, listener]) =>
          event === "selectionchange" &&
          typeof listener === "function" &&
          hookListeners.has(listener),
      );

    function Probe() {
      const editorRef = useRef<HTMLDivElement>(null);
      const savedSelectionRangeRef = useRef<Range | null>(null);
      const { updateSelectionToolbar } = useMarkdownEditorSelectionToolbar({
        editorRef,
        savedSelectionRangeRef,
        saveSelectionRange: save,
        variant: "document",
      });
      hookListeners.add(updateSelectionToolbar);
      return (
        <div
          ref={editorRef}
          data-testid="editor"
          contentEditable
          suppressContentEditableWarning
        >
          Hello world
        </div>
      );
    }

    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <Probe />
        </Activity>
      </StrictMode>,
    );
    expect(hookSelectionAdds()).toHaveLength(2);
    expect(hookSelectionRemoves()).toHaveLength(1);

    const editor = screen.getByTestId("editor");
    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <Probe />
        </Activity>
      </StrictMode>,
    );
    expect(hookSelectionRemoves()).toHaveLength(2);

    // Events while hidden must not invoke the detached listener.
    act(() => {
      selectAllIn(editor);
      document.dispatchEvent(new Event("selectionchange"));
    });
    expect(save).not.toHaveBeenCalled();

    rerender(
      <StrictMode>
        <Activity mode="visible">
          <Probe />
        </Activity>
      </StrictMode>,
    );
    act(() => {
      document.dispatchEvent(new Event("selectionchange"));
    });
    expect(save).toHaveBeenCalledTimes(1);

    unmount();
  });
});
