import { describe, expect, it, vi } from "vitest";

import {
  clearStickyFormatsWithoutDom,
  tryExitComposerInlineFormatOnArrow,
} from "@/lib/utils/composer-wysiwyg-arrow-exit";

function placeCaretInText(editor: HTMLElement, textNode: Node, offset: number) {
  const selection = window.getSelection();
  if (!selection) throw new Error("No selection");
  const range = document.createRange();
  range.setStart(textNode, offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  editor.focus();
}

function selectionInsideTag(tagName: string): boolean {
  const selection = window.getSelection();
  let node: Node | null | undefined = selection?.anchorNode;
  while (node) {
    if (node instanceof HTMLElement && node.tagName === tagName) return true;
    node = node.parentNode;
  }
  return false;
}

describe("tryExitComposerInlineFormatOnArrow", () => {
  it("exits bold at the end with ArrowRight", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.innerHTML = "<strong>hi</strong>";
    document.body.append(editor);

    const text = editor.querySelector("strong")?.firstChild;
    expect(text).toBeTruthy();
    placeCaretInText(editor, text!, 2);

    expect(tryExitComposerInlineFormatOnArrow(editor, "right")).toBe(true);
    expect(selectionInsideTag("STRONG")).toBe(false);

    editor.remove();
  });

  it("exits bold at the start with ArrowLeft", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.innerHTML = "<strong>hi</strong>";
    document.body.append(editor);

    const text = editor.querySelector("strong")?.firstChild;
    expect(text).toBeTruthy();
    placeCaretInText(editor, text!, 0);

    expect(tryExitComposerInlineFormatOnArrow(editor, "left")).toBe(true);
    expect(selectionInsideTag("STRONG")).toBe(false);

    editor.remove();
  });

  it("does not exit when moving deeper into the mark", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.innerHTML = "<strong>hi</strong>";
    document.body.append(editor);

    const text = editor.querySelector("strong")?.firstChild;
    expect(text).toBeTruthy();
    placeCaretInText(editor, text!, 0);

    expect(tryExitComposerInlineFormatOnArrow(editor, "right")).toBe(false);
    placeCaretInText(editor, text!, 2);
    expect(tryExitComposerInlineFormatOnArrow(editor, "left")).toBe(false);

    editor.remove();
  });

  it("exits nested italic first, then bold", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.innerHTML = "<strong><em>hi</em></strong>";
    document.body.append(editor);

    const text = editor.querySelector("em")?.firstChild;
    expect(text).toBeTruthy();
    placeCaretInText(editor, text!, 2);

    expect(tryExitComposerInlineFormatOnArrow(editor, "right")).toBe(true);
    expect(selectionInsideTag("EM")).toBe(false);
    expect(selectionInsideTag("STRONG")).toBe(true);

    expect(tryExitComposerInlineFormatOnArrow(editor, "right")).toBe(true);
    expect(selectionInsideTag("STRONG")).toBe(false);

    editor.remove();
  });

  it("exits styled span marks used by execCommand styleWithCSS", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.innerHTML = '<span style="font-weight: 700">hi</span>';
    document.body.append(editor);

    const text = editor.querySelector("span")?.firstChild;
    expect(text).toBeTruthy();
    placeCaretInText(editor, text!, 2);

    expect(tryExitComposerInlineFormatOnArrow(editor, "right")).toBe(true);
    expect(
      editor
        .querySelector('span[style*="font-weight"]')
        ?.contains(window.getSelection()?.anchorNode ?? null),
    ).toBe(false);

    editor.remove();
  });

  it("exits when caret is before a trailing br inside the mark", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.innerHTML = "<strong>hi<br></strong>";
    document.body.append(editor);

    const strong = editor.querySelector("strong");
    const text = strong?.firstChild;
    expect(text).toBeTruthy();
    // Caret after "hi", before <br> — Chrome often leaves a br in the mark.
    placeCaretInText(editor, text!, 2);

    expect(tryExitComposerInlineFormatOnArrow(editor, "right")).toBe(true);
    expect(selectionInsideTag("STRONG")).toBe(false);

    editor.remove();
  });

  it("clears sticky queryCommandState after leaving a mark", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.innerHTML = "<strong>hi</strong>";
    document.body.append(editor);

    const text = editor.querySelector("strong")?.firstChild;
    expect(text).toBeTruthy();
    placeCaretInText(editor, text!, 2);

    const queryCommandState = vi.fn((command: string) => command === "bold");
    Object.defineProperty(document, "queryCommandState", {
      configurable: true,
      writable: true,
      value: queryCommandState,
    });
    const execCommand = vi.fn(() => {
      queryCommandState.mockImplementation(() => false);
      return true;
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      writable: true,
      value: execCommand,
    });

    expect(tryExitComposerInlineFormatOnArrow(editor, "right")).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("bold");

    editor.remove();
  });
});

describe("clearStickyFormatsWithoutDom", () => {
  it("toggles sticky bold off when DOM has no bold ancestor", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.textContent = "plain";
    document.body.append(editor);
    placeCaretInText(editor, editor.firstChild!, 5);

    const queryCommandState = vi.fn((command: string) => command === "bold");
    Object.defineProperty(document, "queryCommandState", {
      configurable: true,
      writable: true,
      value: queryCommandState,
    });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      writable: true,
      value: execCommand,
    });

    expect(clearStickyFormatsWithoutDom(editor)).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("bold");

    editor.remove();
  });
});
