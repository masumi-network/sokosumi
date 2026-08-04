import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  ComposerWysiwygEditor,
  type ComposerWysiwygEditorHandle,
} from "@/components/chat/composer-wysiwyg-editor";

const getPopupPositionFromRect = vi.hoisted(() =>
  vi.fn(() => ({
    top: 400,
    left: 80,
    side: "top" as const,
    maxHeight: 120,
  })),
);

vi.mock("@/components/ui/mention-textarea-utils", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/components/ui/mention-textarea-utils")
    >();
  return {
    ...actual,
    getPopupPositionFromRect,
  };
});

describe("ComposerWysiwygEditor", () => {
  it("applies top-side flip and dynamic maxHeight to the mention listbox", () => {
    function Harness() {
      const editorRef = useRef<ComposerWysiwygEditorHandle>(null);
      const [value, setValue] = useState("");
      return (
        <>
          <button
            type="button"
            onClick={() => editorRef.current?.openMentions()}
          >
            open-mentions
          </button>
          <ComposerWysiwygEditor
            ref={editorRef}
            value={value}
            onChange={setValue}
            mentions={{
              alice: { value: "Alice" },
              bob: { value: "Bob" },
            }}
          />
        </>
      );
    }

    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "open-mentions" }));

    const listbox = screen.getByRole("listbox");
    expect(listbox).toHaveStyle({
      maxHeight: "120px",
      transform: "translateY(-100%)",
    });
    expect(getPopupPositionFromRect).toHaveBeenCalled();
  });

  it("submits on plain Enter on desktop and newlines on Shift+Enter", () => {
    const onSubmitShortcut = vi.fn();

    function Harness() {
      const [value, setValue] = useState("");
      return (
        <ComposerWysiwygEditor
          value={value}
          onChange={setValue}
          mentions={{}}
          onSubmitShortcut={onSubmitShortcut}
        />
      );
    }

    render(<Harness />);

    const editor = screen.getByRole("textbox");
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(onSubmitShortcut).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(editor, { key: "Enter", shiftKey: true });
    expect(onSubmitShortcut).toHaveBeenCalledTimes(1);
  });

  it("opens link shortcut on Cmd+K", () => {
    const onLinkShortcut = vi.fn();

    function Harness() {
      const [value, setValue] = useState("");
      return (
        <ComposerWysiwygEditor
          value={value}
          onChange={setValue}
          mentions={{}}
          onLinkShortcut={onLinkShortcut}
        />
      );
    }

    render(<Harness />);
    fireEvent.keyDown(screen.getByRole("textbox"), {
      key: "k",
      metaKey: true,
    });
    expect(onLinkShortcut).toHaveBeenCalledTimes(1);
  });

  it("clears editor DOM when parent value is cleared while focused after typing", () => {
    function Harness() {
      const [value, setValue] = useState("typing indicators please");
      return (
        <>
          <button type="button" onClick={() => setValue("")}>
            clear
          </button>
          <ComposerWysiwygEditor
            value={value}
            onChange={setValue}
            mentions={{}}
          />
        </>
      );
    }

    render(<Harness />);
    const editor = screen.getByRole("textbox");
    editor.focus();
    expect(editor).toHaveFocus();
    expect(editor.textContent).toContain("typing indicators please");

    fireEvent.click(screen.getByRole("button", { name: "clear" }));

    expect(editor.textContent ?? "").toBe("");
  });

  it("clears editor DOM after internal input then external clear in the same focused session", () => {
    function Harness() {
      const [value, setValue] = useState("");
      return (
        <>
          <button type="button" onClick={() => setValue("")}>
            clear
          </button>
          <ComposerWysiwygEditor
            value={value}
            onChange={setValue}
            mentions={{}}
          />
        </>
      );
    }

    render(<Harness />);
    const editor = screen.getByRole("textbox");
    editor.focus();
    editor.innerHTML = "typing indicators please";
    fireEvent.input(editor);
    expect(editor.textContent).toContain("typing indicators please");

    fireEvent.click(screen.getByRole("button", { name: "clear" }));

    expect(editor.textContent ?? "").toBe("");
  });

  it("clears editor when parent clears in the same act as an internal input", () => {
    function Harness() {
      const [value, setValue] = useState("typing indicators please");
      return (
        <>
          <button type="button" onClick={() => setValue("")}>
            clear-only
          </button>
          <ComposerWysiwygEditor
            value={value}
            onChange={setValue}
            mentions={{}}
          />
        </>
      );
    }

    render(<Harness />);
    const editor = screen.getByRole("textbox");
    editor.focus();
    expect(editor.textContent).toContain("typing indicators please");

    // Internal input marks isInternalChange; clear in the same act before the
    // value-sync effect can reset that flag. Value must change (text → "") so
    // React commits and the sync effect runs.
    act(() => {
      fireEvent.input(editor);
      fireEvent.click(screen.getByRole("button", { name: "clear-only" }));
    });

    expect(editor.textContent ?? "").toBe("");
  });

  it("restores editor text while focused after an external clear", () => {
    function Harness() {
      const [value, setValue] = useState("typing indicators please");
      return (
        <>
          <button type="button" onClick={() => setValue("")}>
            clear
          </button>
          <button
            type="button"
            onClick={() => setValue("typing indicators please")}
          >
            restore
          </button>
          <ComposerWysiwygEditor
            value={value}
            onChange={setValue}
            mentions={{}}
          />
        </>
      );
    }

    render(<Harness />);
    const editor = screen.getByRole("textbox");
    editor.focus();

    fireEvent.click(screen.getByRole("button", { name: "clear" }));
    expect(editor.textContent ?? "").toBe("");

    fireEvent.click(screen.getByRole("button", { name: "restore" }));
    expect(editor.textContent).toContain("typing indicators please");
  });

  it("inserts text at the saved caret after selection leaves the editor", () => {
    function Harness() {
      const editorRef = useRef<ComposerWysiwygEditorHandle>(null);
      const [value, setValue] = useState("hello world");
      return (
        <>
          <button type="button" onClick={() => editorRef.current?.focus()}>
            focus-editor
          </button>
          <button
            type="button"
            onClick={() => editorRef.current?.insertText("😀")}
          >
            insert-emoji
          </button>
          <button type="button" aria-label="picker-search">
            picker-search
          </button>
          <ComposerWysiwygEditor
            ref={editorRef}
            value={value}
            onChange={setValue}
            mentions={{}}
          />
          <output data-testid="composer-value">{value}</output>
        </>
      );
    }

    render(<Harness />);
    const editor = screen.getByRole("textbox");
    fireEvent.click(screen.getByRole("button", { name: "focus-editor" }));

    const textNode = editor.firstChild;
    expect(textNode?.nodeType).toBe(Node.TEXT_NODE);
    const selection = window.getSelection();
    expect(selection).not.toBeNull();
    const range = document.createRange();
    // Caret after "hello " (offset 6).
    range.setStart(textNode as Text, 6);
    range.collapse(true);
    selection!.removeAllRanges();
    selection!.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    // Picker search steals focus and clears the live document selection.
    fireEvent.click(screen.getByRole("button", { name: "picker-search" }));
    selection!.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));

    fireEvent.click(screen.getByRole("button", { name: "insert-emoji" }));

    expect(screen.getByTestId("composer-value")).toHaveTextContent(
      "hello 😀world",
    );
  });
});
