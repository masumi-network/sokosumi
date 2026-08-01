import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EMPTY_COMPOSER_ACTIVE_FORMATS,
  getComposerActiveFormats,
} from "@/lib/utils/composer-active-formats";

function placeCaretIn(editor: HTMLElement, textHost: Node): void {
  const selection = window.getSelection();
  if (!selection) throw new Error("No selection");
  const range = document.createRange();
  if (textHost.nodeType === Node.TEXT_NODE) {
    range.setStart(textHost, Math.min(1, textHost.textContent?.length ?? 0));
  } else {
    range.selectNodeContents(textHost);
    range.collapse(true);
  }
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  editor.focus();
}

function selectNodeContents(editor: HTMLElement, host: Node): void {
  const selection = window.getSelection();
  if (!selection) throw new Error("No selection");
  const range = document.createRange();
  range.selectNodeContents(host);
  selection.removeAllRanges();
  selection.addRange(range);
  editor.focus();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getComposerActiveFormats", () => {
  it("returns empty when selection is outside the editor", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.innerHTML = "<strong>hi</strong>";
    document.body.append(editor);

    const outside = document.createElement("div");
    outside.textContent = "out";
    document.body.append(outside);
    placeCaretIn(outside, outside.firstChild!);

    expect(getComposerActiveFormats(editor)).toEqual(
      EMPTY_COMPOSER_ACTIVE_FORMATS,
    );

    editor.remove();
    outside.remove();
  });

  it("detects inline marks and link from a range selection", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.innerHTML =
      '<p><strong><em><u><s><a href="https://example.com">x</a></s></u></em></strong></p>';
    document.body.append(editor);

    const text = editor.querySelector("a")?.firstChild;
    expect(text).toBeTruthy();
    selectNodeContents(editor, text!);

    expect(getComposerActiveFormats(editor)).toMatchObject({
      bold: true,
      italic: true,
      underline: true,
      strikethrough: true,
      link: true,
      code: false,
      codeBlock: false,
    });

    editor.remove();
  });

  it("uses queryCommandState for collapsed caret typing style", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.innerHTML = "<p><strong>bold</strong></p>";
    document.body.append(editor);

    const text = editor.querySelector("strong")?.firstChild;
    expect(text).toBeTruthy();
    placeCaretIn(editor, text!);

    const queryCommandState = vi.fn((command: string) => command === "bold");
    Object.defineProperty(document, "queryCommandState", {
      configurable: true,
      writable: true,
      value: queryCommandState,
    });
    expect(getComposerActiveFormats(editor).bold).toBe(true);

    queryCommandState.mockImplementation(() => false);
    // Caret still inside <strong>, but typing style is off after toggle.
    expect(getComposerActiveFormats(editor).bold).toBe(false);

    editor.remove();
  });

  it("detects lists, quote, and code block", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.innerHTML =
      "<blockquote><ul><li>one</li></ul></blockquote><pre><code>block</code></pre>";
    document.body.append(editor);

    const listText = editor.querySelector("li")?.firstChild;
    expect(listText).toBeTruthy();
    selectNodeContents(editor, listText!);
    expect(getComposerActiveFormats(editor)).toMatchObject({
      quote: true,
      bulletList: true,
      numberedList: false,
      codeBlock: false,
    });

    const codeText = editor.querySelector("pre code")?.firstChild;
    expect(codeText).toBeTruthy();
    placeCaretIn(editor, codeText!);
    expect(getComposerActiveFormats(editor)).toMatchObject({
      code: false,
      codeBlock: true,
    });

    editor.remove();
  });

  it("detects inline code without treating it as a code block", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.innerHTML = "<p>before <code>snip</code> after</p>";
    document.body.append(editor);

    const codeText = editor.querySelector("code")?.firstChild;
    expect(codeText).toBeTruthy();
    placeCaretIn(editor, codeText!);
    expect(getComposerActiveFormats(editor)).toMatchObject({
      code: true,
      codeBlock: false,
    });

    editor.remove();
  });
});
