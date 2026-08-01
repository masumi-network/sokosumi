import { describe, expect, it } from "vitest";

import { tryExitComposerInlineFormatOnArrow } from "@/lib/utils/composer-wysiwyg-arrow-exit";

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
    expect(getComposerSelectionParentTag()).not.toBe("STRONG");

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
    expect(getComposerSelectionParentTag()).not.toBe("STRONG");

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
    expect(getComposerSelectionParentTag()).toBe("STRONG");

    expect(tryExitComposerInlineFormatOnArrow(editor, "right")).toBe(true);
    expect(getComposerSelectionParentTag()).not.toBe("STRONG");

    editor.remove();
  });
});

function getComposerSelectionParentTag(): string | null {
  const selection = window.getSelection();
  const node = selection?.anchorNode;
  if (!node) return null;
  const element =
    node.nodeType === Node.TEXT_NODE
      ? node.parentElement
      : (node as HTMLElement);
  return element?.tagName ?? null;
}
