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

    function Probe({
      variant,
      saveSelectionRange,
    }: {
      variant: "field" | "document";
      saveSelectionRange: () => void;
    }) {
      const editorRef = useRef<HTMLDivElement>(null);
      const savedSelectionRangeRef = useRef<Range | null>(null);
      const { selectionRect } = useMarkdownEditorSelectionToolbar({
        editorRef,
        savedSelectionRangeRef,
        saveSelectionRange,
        variant,
      });
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
    expect(
      addSpy.mock.calls.filter(([event]) => event === "selectionchange"),
    ).toHaveLength(0);
    expect(captured.rect).toBeNull();

    rerender(<Probe variant="document" saveSelectionRange={saveA} />);
    expect(
      addSpy.mock.calls.filter(([event]) => event === "selectionchange"),
    ).toHaveLength(1);

    const editor = screen.getByTestId("editor");
    act(() => {
      selectAllIn(editor);
    });
    expect(captured.rect).toBe(SAMPLE_RECT);
    expect(saveA).toHaveBeenCalledTimes(1);
    expect(saveB).not.toHaveBeenCalled();

    // Changing saveSelectionRange between events must rebind the listener to the new callback.
    rerender(<Probe variant="document" saveSelectionRange={saveB} />);
    expect(
      removeSpy.mock.calls.filter(([event]) => event === "selectionchange"),
    ).toHaveLength(1);
    expect(
      addSpy.mock.calls.filter(([event]) => event === "selectionchange"),
    ).toHaveLength(2);

    act(() => {
      document.dispatchEvent(new Event("selectionchange"));
    });
    expect(saveA).toHaveBeenCalledTimes(1);
    expect(saveB).toHaveBeenCalledTimes(1);

    // Switching back to field variant detaches listener and clears selectionRect.
    rerender(<Probe variant="field" saveSelectionRange={saveB} />);
    expect(
      removeSpy.mock.calls.filter(([event]) => event === "selectionchange"),
    ).toHaveLength(2);
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

    function Probe() {
      const editorRef = useRef<HTMLDivElement>(null);
      const savedSelectionRangeRef = useRef<Range | null>(null);
      useMarkdownEditorSelectionToolbar({
        editorRef,
        savedSelectionRangeRef,
        saveSelectionRange: save,
        variant: "document",
      });
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
    expect(
      addSpy.mock.calls.filter(([event]) => event === "selectionchange"),
    ).toHaveLength(2);
    expect(
      removeSpy.mock.calls.filter(([event]) => event === "selectionchange"),
    ).toHaveLength(1);

    const editor = screen.getByTestId("editor");
    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <Probe />
        </Activity>
      </StrictMode>,
    );
    expect(
      removeSpy.mock.calls.filter(([event]) => event === "selectionchange"),
    ).toHaveLength(2);

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
