import { render, screen } from "@testing-library/react";
import { Activity, type RefObject, StrictMode, useRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { useMarkdownEditorValueSync } from "./use-markdown-editor-value-sync";

function EditorSyncHarness({
  value,
  convertMarkdownToHtml,
  isInternalChange,
  onInnerHtmlWrite,
}: {
  value: string;
  convertMarkdownToHtml: (text: string) => string;
  isInternalChange: RefObject<boolean>;
  onInnerHtmlWrite?: (html: string) => void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const wiredNode = useRef<HTMLDivElement | null>(null);
  useMarkdownEditorValueSync(
    editorRef,
    isInternalChange,
    value,
    convertMarkdownToHtml,
  );
  return (
    <div
      data-testid="editor"
      contentEditable
      suppressContentEditableWarning
      ref={(node) => {
        editorRef.current = node;
        if (node && onInnerHtmlWrite && wiredNode.current !== node) {
          wiredNode.current = node;
          const proto = Object.getOwnPropertyDescriptor(
            Element.prototype,
            "innerHTML",
          );
          if (proto?.get && proto?.set) {
            const get = proto.get;
            const set = proto.set;
            Object.defineProperty(node, "innerHTML", {
              configurable: true,
              get() {
                return get.call(this);
              },
              set(next: string) {
                onInnerHtmlWrite(next);
                set.call(this, next);
              },
            });
          }
        }
      }}
    />
  );
}

describe("useMarkdownEditorValueSync", () => {
  it("syncs external value changes, skips focused non-empty updates, applies external clears, and resets isInternalChange", () => {
    const isInternalChange = { current: false };
    const convert = (text: string) => (text.trim() ? `<p>${text}</p>` : "");

    const { rerender, unmount } = render(
      <EditorSyncHarness
        value="Hello"
        convertMarkdownToHtml={convert}
        isInternalChange={isInternalChange}
      />,
    );
    const editor = screen.getByTestId("editor");
    expect(editor.innerHTML).toBe("<p>Hello</p>");
    expect(editor.hasAttribute("data-empty")).toBe(false);

    // Internal edits skip DOM rewrite and clear the flag.
    isInternalChange.current = true;
    rerender(
      <EditorSyncHarness
        value="Typed locally"
        convertMarkdownToHtml={convert}
        isInternalChange={isInternalChange}
      />,
    );
    expect(editor.innerHTML).toBe("<p>Hello</p>");
    expect(isInternalChange.current).toBe(false);

    // Focused editor ignores external non-empty updates to avoid cursor jumping.
    editor.focus();
    rerender(
      <EditorSyncHarness
        value="Remote update"
        convertMarkdownToHtml={convert}
        isInternalChange={isInternalChange}
      />,
    );
    expect(editor.innerHTML).toBe("<p>Hello</p>");

    // External clear still wipes a focused editor and sets data-empty.
    rerender(
      <EditorSyncHarness
        value="   "
        convertMarkdownToHtml={convert}
        isInternalChange={isInternalChange}
      />,
    );
    expect(editor.innerHTML).toBe("");
    expect(editor.hasAttribute("data-empty")).toBe(true);

    unmount();
  });

  it("re-runs when convertMarkdownToHtml identity changes even if value is unchanged", () => {
    const isInternalChange = { current: false };
    const convertA = vi.fn((text: string) => `<p>${text}</p>`);
    const convertB = vi.fn((text: string) => `<p>${text}</p>`);

    const { rerender, unmount } = render(
      <EditorSyncHarness
        value="Hello"
        convertMarkdownToHtml={convertA}
        isInternalChange={isInternalChange}
      />,
    );
    expect(convertA).toHaveBeenCalledTimes(1);
    expect(convertB).not.toHaveBeenCalled();

    rerender(
      <EditorSyncHarness
        value="Hello"
        convertMarkdownToHtml={convertB}
        isInternalChange={isInternalChange}
      />,
    );
    expect(convertB).toHaveBeenCalledTimes(1);

    unmount();
  });

  it("counts exact innerHTML writes across StrictMode replay and Activity hide/reveal", () => {
    const writes: string[] = [];
    const isInternalChange = { current: false };
    const convert = (text: string) => (text.trim() ? `<p>${text}</p>` : "");

    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <EditorSyncHarness
            value="Alpha"
            convertMarkdownToHtml={convert}
            isInternalChange={isInternalChange}
            onInnerHtmlWrite={(html) => writes.push(html)}
          />
        </Activity>
      </StrictMode>,
    );
    // Run 1 writes "<p>Alpha</p>"; StrictMode replay sees currentHtml === newHtml so skips writing again.
    expect(writes).toEqual(["<p>Alpha</p>"]);

    const editor = screen.getByTestId("editor");
    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <EditorSyncHarness
            value="Alpha"
            convertMarkdownToHtml={convert}
            isInternalChange={isInternalChange}
            onInnerHtmlWrite={(html) => writes.push(html)}
          />
        </Activity>
      </StrictMode>,
    );
    // Mutate DOM while hidden; reveal must sync it back once.
    writes.length = 0;
    editor.innerHTML = "<p>Stale</p>";
    writes.length = 0;

    rerender(
      <StrictMode>
        <Activity mode="visible">
          <EditorSyncHarness
            value="Alpha"
            convertMarkdownToHtml={convert}
            isInternalChange={isInternalChange}
            onInnerHtmlWrite={(html) => writes.push(html)}
          />
        </Activity>
      </StrictMode>,
    );
    expect(writes).toEqual(["<p>Alpha</p>"]);

    unmount();
  });
});
