import { beforeEach, describe, expect, it } from "vitest";

import { htmlToMarkdown } from "@/lib/utils/composer-markdown-dom";
import { toggleComposerCodeBlock } from "@/lib/utils/composer-wysiwyg-code-block";

function createEditor(html = ""): HTMLElement {
  const editor = document.createElement("div");
  editor.contentEditable = "true";
  editor.innerHTML = html;
  document.body.append(editor);
  return editor;
}

function placeCaret(node: Node, offset: number): void {
  const selection = window.getSelection();
  if (!selection) throw new Error("No selection");
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function selectAcross(node: Node, start: number, end: number): void {
  const selection = window.getSelection();
  if (!selection) throw new Error("No selection");
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  selection.removeAllRanges();
  selection.addRange(range);
}

function caretIsInside(tagName: string): boolean {
  let node: Node | null | undefined = window.getSelection()?.anchorNode;
  while (node) {
    if (node instanceof HTMLElement && node.tagName === tagName) return true;
    node = node.parentNode;
  }
  return false;
}

describe("toggleComposerCodeBlock", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("opens an empty block with the caret inside the code element", () => {
    const editor = createEditor();
    placeCaret(editor, 0);

    toggleComposerCodeBlock(editor);

    const code = editor.querySelector("pre > code");
    expect(code).not.toBeNull();
    expect(caretIsInside("CODE")).toBe(true);
  });

  it("gives an empty block a line break so it does not collapse", () => {
    const editor = createEditor();
    placeCaret(editor, 0);

    toggleComposerCodeBlock(editor);

    expect(editor.querySelector("pre > code > br")).not.toBeNull();
  });

  it("wraps the selected text inside the code element", () => {
    const editor = createEditor("hello world");
    const text = editor.firstChild;
    if (!text) throw new Error("No text node");
    selectAcross(text, 0, 11);

    toggleComposerCodeBlock(editor);

    expect(editor.querySelector("pre > code")?.textContent).toBe("hello world");
  });

  it("unwraps the block when toggled a second time", () => {
    const editor = createEditor("<pre><code>hello world</code></pre>");
    const code = editor.querySelector("code");
    if (!code?.firstChild) throw new Error("No code text");
    placeCaret(code.firstChild, 0);

    toggleComposerCodeBlock(editor);

    expect(editor.querySelector("pre")).toBeNull();
    expect(editor.textContent).toBe("hello world");
  });

  it("keeps the newlines of a multi-line block when unwrapping", () => {
    const editor = createEditor("<pre><code>first<br>second</code></pre>");
    const code = editor.querySelector("code");
    if (!code?.firstChild) throw new Error("No code text");
    placeCaret(code.firstChild, 0);

    toggleComposerCodeBlock(editor);

    expect(editor.querySelector("pre")).toBeNull();
    expect(editor.querySelectorAll("br")).toHaveLength(1);
  });

  it("leaves nothing behind when an untouched empty block is toggled off", () => {
    const editor = createEditor();
    placeCaret(editor, 0);
    toggleComposerCodeBlock(editor);

    const code = editor.querySelector("code");
    if (!code) throw new Error("No code element");
    placeCaret(code, 0);
    toggleComposerCodeBlock(editor);

    expect(editor.querySelector("pre")).toBeNull();
    expect((editor.textContent ?? "").trim()).toBe("");
  });

  it("serializes a freshly opened empty block as an empty fence", () => {
    const editor = createEditor();
    placeCaret(editor, 0);

    toggleComposerCodeBlock(editor);

    expect(htmlToMarkdown(editor)).toBe("```\n\n```\n");
  });
});
