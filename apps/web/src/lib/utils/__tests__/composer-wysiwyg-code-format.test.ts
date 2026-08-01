import { describe, expect, it } from "vitest";

import {
  COMPOSER_CODE_CARET_MARK,
  toggleComposerInlineCode,
} from "@/lib/utils/composer-wysiwyg-code-format";

function placeCollapsedCaret(editor: HTMLElement, host: Node): void {
  const selection = window.getSelection();
  if (!selection) throw new Error("No selection");
  const range = document.createRange();
  if (host.nodeType === Node.TEXT_NODE) {
    range.setStart(host, host.textContent?.length ?? 0);
  } else {
    range.selectNodeContents(host);
    range.collapse(false);
  }
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  editor.focus();
}

describe("toggleComposerInlineCode", () => {
  it("enters an empty code shell without inserting a placeholder word", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.textContent = "hello ";
    document.body.append(editor);
    placeCollapsedCaret(editor, editor.firstChild!);

    toggleComposerInlineCode(editor);

    const code = editor.querySelector("code");
    expect(code).toBeTruthy();
    expect(code?.textContent).toBe(COMPOSER_CODE_CARET_MARK);
    expect(editor.textContent).not.toContain("code");
    expect(editor.innerHTML).not.toMatch(/>code</);

    editor.remove();
  });

  it("wraps a non-empty selection in code", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.textContent = "hello";
    document.body.append(editor);

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor.firstChild!);
    selection?.removeAllRanges();
    selection?.addRange(range);
    editor.focus();

    toggleComposerInlineCode(editor);

    expect(editor.querySelector("code")?.textContent).toBe("hello");

    editor.remove();
  });

  it("exits an empty code shell when toggled again", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.innerHTML = `hi <code>${COMPOSER_CODE_CARET_MARK}</code>`;
    document.body.append(editor);

    const codeText = editor.querySelector("code")?.firstChild;
    expect(codeText).toBeTruthy();
    placeCollapsedCaret(editor, codeText!);

    toggleComposerInlineCode(editor);

    expect(editor.querySelector("code")).toBeNull();
    expect(editor.textContent).toBe("hi ");

    editor.remove();
  });
});
