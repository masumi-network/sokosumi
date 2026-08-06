import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ComposerWysiwygEditor,
  type ComposerWysiwygEditorHandle,
} from "@/components/chat/composer-wysiwyg-editor";
import { ROOM_COMPOSER_MENTION_ANCHOR_ATTR } from "@/components/chat/room-message-composer";

const getPopupPositionFromRect = vi.hoisted(() =>
  vi.fn(() => ({
    top: 400,
    left: 80,
    side: "top" as const,
    maxHeight: 120,
  })),
);

const getMentionPopupPositionFromAnchorRect = vi.hoisted(() =>
  vi.fn(() => ({
    top: 500,
    left: 24,
    side: "top" as const,
    maxHeight: 200,
    width: 420,
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
    getMentionPopupPositionFromAnchorRect,
  };
});

describe("ComposerWysiwygEditor", () => {
  afterEach(() => {
    getPopupPositionFromRect.mockClear();
    getMentionPopupPositionFromAnchorRect.mockClear();
  });

  it("disables Inter contextual alternates so ** markers stay aligned", () => {
    function Harness() {
      const [value, setValue] = useState("");
      return (
        <ComposerWysiwygEditor
          value={value}
          onChange={setValue}
          mentions={{}}
        />
      );
    }

    render(<Harness />);
    expect(screen.getByRole("textbox")).toHaveClass("markdown-compose-surface");
  });

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
    expect(getMentionPopupPositionFromAnchorRect).not.toHaveBeenCalled();
  });

  it("anchors mention listbox to the composer card when the data attr is present", () => {
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
          <div {...{ [ROOM_COMPOSER_MENTION_ANCHOR_ATTR]: "" }}>
            <ComposerWysiwygEditor
              ref={editorRef}
              value={value}
              onChange={setValue}
              mentions={{
                alice: { value: "Alice" },
                bob: { value: "Bob" },
              }}
            />
          </div>
        </>
      );
    }

    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "open-mentions" }));

    const listbox = screen.getByRole("listbox");
    expect(getMentionPopupPositionFromAnchorRect).toHaveBeenCalled();
    expect(getPopupPositionFromRect).not.toHaveBeenCalled();
    expect(listbox).toHaveStyle({
      maxHeight: "200px",
      transform: "translateY(-100%)",
      width: "420px",
    });
    expect(listbox).not.toHaveClass("w-72");
  });

  it("keeps the mention listbox open when openMentions runs after editor blur", () => {
    vi.useFakeTimers();

    function Harness() {
      const editorRef = useRef<ComposerWysiwygEditorHandle>(null);
      const [value, setValue] = useState("");
      return (
        <>
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
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

    try {
      render(<Harness />);
      const editor = screen.getByRole("textbox");
      act(() => {
        editor.focus();
      });
      // Toolbar click path: editor blurs before openMentions runs.
      fireEvent.blur(editor);
      fireEvent.click(screen.getByRole("button", { name: "open-mentions" }));
      expect(screen.getByRole("listbox")).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("inserts a mention from the toolbar picker when no @ trigger is typed", () => {
    function Harness() {
      const editorRef = useRef<ComposerWysiwygEditorHandle>(null);
      const [value, setValue] = useState("hello");
      return (
        <>
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
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
    const editor = screen.getByRole("textbox");
    act(() => {
      editor.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
    });

    fireEvent.click(screen.getByRole("button", { name: "open-mentions" }));
    const option = screen.getByRole("option", { name: /Alice/i });

    // Listbox click leaves selection outside the editor (portal).
    act(() => {
      const selection = window.getSelection();
      const outside = document.createTextNode("outside");
      document.body.appendChild(outside);
      const range = document.createRange();
      range.setStart(outside, 0);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
    });

    fireEvent.mouseDown(option);
    fireEvent.click(option);

    expect(editor.querySelector("[data-mention-key='alice']")).not.toBeNull();
    expect(editor.textContent).toMatch(/hello\s*@Alice/);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("anchors emoji shortcode popup to the composer shell", () => {
    function Harness() {
      const [value, setValue] = useState("");
      return (
        <div {...{ [ROOM_COMPOSER_MENTION_ANCHOR_ATTR]: "" }}>
          <ComposerWysiwygEditor
            value={value}
            onChange={setValue}
            mentions={{}}
          />
        </div>
      );
    }

    render(<Harness />);
    const editor = screen.getByRole("textbox");
    editor.focus();
    editor.textContent = ":smi";
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent.input(editor);

    const listbox = screen.getByRole("listbox");
    expect(getMentionPopupPositionFromAnchorRect).toHaveBeenCalled();
    expect(getPopupPositionFromRect).not.toHaveBeenCalled();
    expect(listbox).toHaveStyle({
      maxHeight: "200px",
      transform: "translateY(-100%)",
      width: "420px",
    });
    expect(listbox).not.toHaveClass("w-72");
  });

  it("keeps emoji shortcode popup on the caret when no composer anchor", () => {
    function Harness() {
      const [value, setValue] = useState("");
      return (
        <ComposerWysiwygEditor
          value={value}
          onChange={setValue}
          mentions={{}}
        />
      );
    }

    render(<Harness />);
    const editor = screen.getByRole("textbox");
    editor.focus();
    editor.textContent = ":smi";
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent.input(editor);

    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(getPopupPositionFromRect).toHaveBeenCalled();
    expect(getMentionPopupPositionFromAnchorRect).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox")).toHaveClass("w-72");
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

  it("pastes plain text only and drops rich clipboard HTML", () => {
    function Harness() {
      const [value, setValue] = useState("");
      return (
        <ComposerWysiwygEditor
          value={value}
          onChange={setValue}
          mentions={{}}
        />
      );
    }

    render(<Harness />);
    const editor = screen.getByRole("textbox");
    editor.focus();

    const execCommand = vi.fn(
      (command: string, _showUI?: boolean, value?: string) => {
        if (command === "insertText" && typeof value === "string") {
          editor.textContent = (editor.textContent ?? "") + value;
          return true;
        }
        return false;
      },
    );
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });

    const html =
      '<a href="https://x.com/status/1" style="color: rgb(10, 10, 10);"><strong>https://x.com/status/1</strong></a>';
    fireEvent.paste(editor, {
      clipboardData: {
        getData: (type: string) => {
          if (type === "text/html") return html;
          if (type === "text/plain") {
            return "https://x.com/status/1";
          }
          return "";
        },
      },
    });

    expect(execCommand).toHaveBeenCalledWith(
      "insertText",
      false,
      "https://x.com/status/1",
    );
    expect(execCommand).not.toHaveBeenCalledWith(
      "insertHTML",
      expect.anything(),
      expect.anything(),
    );
    expect(editor.innerHTML).not.toMatch(/<a\b|<strong\b|color\s*:/i);
    expect(editor.textContent).toContain("https://x.com/status/1");
  });

  it("falls back to DOM text insert when insertText fails", () => {
    function Harness() {
      const [value, setValue] = useState("");
      return (
        <ComposerWysiwygEditor
          value={value}
          onChange={setValue}
          mentions={{}}
        />
      );
    }

    render(<Harness />);
    const editor = screen.getByRole("textbox");
    editor.focus();

    const execCommand = vi.fn(() => false);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });

    const html =
      '<span style="color: rgb(10, 10, 10);"><em>fallback plain path</em></span>';
    fireEvent.paste(editor, {
      clipboardData: {
        getData: (type: string) => {
          if (type === "text/html") return html;
          if (type === "text/plain") return "fallback plain path";
          return "";
        },
      },
    });

    expect(execCommand).toHaveBeenCalledWith(
      "insertText",
      false,
      "fallback plain path",
    );
    expect(editor.innerHTML).not.toMatch(/<em\b|color\s*:/i);
    expect(editor.textContent).toContain("fallback plain path");
  });

  it("extracts plain text from HTML when clipboard has no text/plain", () => {
    function Harness() {
      const [value, setValue] = useState("");
      return (
        <ComposerWysiwygEditor
          value={value}
          onChange={setValue}
          mentions={{}}
        />
      );
    }

    render(<Harness />);
    const editor = screen.getByRole("textbox");
    editor.focus();

    const execCommand = vi.fn(
      (command: string, _showUI?: boolean, value?: string) => {
        if (command === "insertText" && typeof value === "string") {
          editor.textContent = value;
          return true;
        }
        return false;
      },
    );
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });

    fireEvent.paste(editor, {
      clipboardData: {
        getData: (type: string) => {
          if (type === "text/html") {
            return "<b>only html</b>";
          }
          return "";
        },
      },
    });

    expect(execCommand).toHaveBeenCalledWith("insertText", false, "only html");
    expect(editor.textContent).toBe("only html");
  });

  it("prevents default for HTML-only paste even when extractable text is empty", () => {
    function Harness() {
      const [value, setValue] = useState("");
      return (
        <ComposerWysiwygEditor
          value={value}
          onChange={setValue}
          mentions={{}}
        />
      );
    }

    render(<Harness />);
    const editor = screen.getByRole("textbox");
    editor.focus();
    editor.innerHTML = "";

    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });

    const pasteEvent = fireEvent.paste(editor, {
      clipboardData: {
        getData: (type: string) => {
          if (type === "text/html") {
            return '<img src="https://example.com/x.png" alt="">';
          }
          return "";
        },
      },
    });

    // fireEvent.paste returns false when preventDefault was called
    expect(pasteEvent).toBe(false);
    expect(execCommand).not.toHaveBeenCalled();
    expect(editor.innerHTML).not.toMatch(/<img\b/i);
  });

  it("strips color styles left by insertHTML on input", () => {
    function Harness() {
      const [value, setValue] = useState("");
      return (
        <ComposerWysiwygEditor
          value={value}
          onChange={setValue}
          mentions={{}}
        />
      );
    }

    render(<Harness />);
    const editor = screen.getByRole("textbox");
    editor.focus();
    editor.innerHTML =
      '<span style="color: rgb(10, 10, 10);">stuck dark</span>';
    fireEvent.input(editor);

    expect(editor.innerHTML).not.toMatch(/color\s*:/i);
    expect(editor.textContent).toBe("stuck dark");
  });
});
