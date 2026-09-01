import { describe, expect, it } from "vitest";

import { htmlToMarkdown } from "@/lib/utils/composer-markdown-dom";
import {
  toggleComposerBlockquote,
  tryExitComposerBlockquoteOnEmptyLine,
} from "@/lib/utils/composer-wysiwyg-blockquote";

function placeCaret(node: Node, offset: number) {
  const selection = window.getSelection();
  if (!selection) throw new Error("No selection");
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
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

function visibleText(node: Node): string {
  return (node.textContent ?? "").replace(/\u200b/g, "");
}

describe("tryExitComposerBlockquoteOnEmptyLine", () => {
  it("leaves the quote when the caret is on an empty last line", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.innerHTML = "<blockquote>hello<br></blockquote>";
    document.body.append(editor);

    const quote = editor.querySelector("blockquote");
    expect(quote).toBeTruthy();
    placeCaret(quote!, quote!.childNodes.length);
    editor.focus();

    expect(tryExitComposerBlockquoteOnEmptyLine(editor)).toBe(true);
    expect(selectionInsideTag("BLOCKQUOTE")).toBe(false);
    expect(editor.querySelector("blockquote")?.textContent).toContain("hello");
    expect(visibleText(editor)).toContain("hello");
    const markdown = htmlToMarkdown(editor);
    expect(markdown).toMatch(/^> hello\n/);
    expect(markdown).not.toMatch(/^> hello\n>/);

    editor.remove();
  });

  it("does not leave the quote while the current line still has text", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.innerHTML = "<blockquote>hello</blockquote>";
    document.body.append(editor);

    const text = editor.querySelector("blockquote")?.firstChild;
    expect(text).toBeTruthy();
    placeCaret(text!, "hello".length);
    editor.focus();

    expect(tryExitComposerBlockquoteOnEmptyLine(editor)).toBe(false);
    expect(selectionInsideTag("BLOCKQUOTE")).toBe(true);
    expect(editor.querySelector("blockquote")?.textContent).toBe("hello");

    editor.remove();
  });

  it("does not leave the quote when more quoted text follows the caret", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.innerHTML = "<blockquote>hello<br>world</blockquote>";
    document.body.append(editor);

    const quote = editor.querySelector("blockquote");
    const hello = quote?.firstChild;
    expect(hello).toBeTruthy();
    placeCaret(hello!, "hello".length);
    editor.focus();

    expect(tryExitComposerBlockquoteOnEmptyLine(editor)).toBe(false);
    expect(selectionInsideTag("BLOCKQUOTE")).toBe(true);
    expect(visibleText(quote!)).toContain("world");

    editor.remove();
  });

  it("unwraps an empty quote so typing continues in a normal block", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.innerHTML = "<blockquote><br></blockquote>";
    document.body.append(editor);
    placeCaret(editor.querySelector("blockquote")!, 0);
    editor.focus();

    expect(tryExitComposerBlockquoteOnEmptyLine(editor)).toBe(true);
    expect(editor.querySelector("blockquote")).toBeNull();
    expect(selectionInsideTag("BLOCKQUOTE")).toBe(false);

    editor.remove();
  });

  it("returns false when the caret is not inside a quote", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.innerHTML = "plain";
    document.body.append(editor);
    placeCaret(editor.firstChild!, 5);
    editor.focus();

    expect(tryExitComposerBlockquoteOnEmptyLine(editor)).toBe(false);

    editor.remove();
  });
});

describe("toggleComposerBlockquote", () => {
  it("wraps the current block in a quote", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.innerHTML = "hello";
    document.body.append(editor);
    placeCaret(editor.firstChild!, 5);
    editor.focus();

    toggleComposerBlockquote(editor);

    expect(editor.querySelector("blockquote")?.textContent).toContain("hello");
    expect(selectionInsideTag("BLOCKQUOTE")).toBe(true);

    editor.remove();
  });

  it("unwraps when the caret is already in a quote", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.innerHTML = "<blockquote>hello</blockquote>";
    document.body.append(editor);
    const text = editor.querySelector("blockquote")?.firstChild;
    expect(text).toBeTruthy();
    placeCaret(text!, 2);
    editor.focus();

    toggleComposerBlockquote(editor);

    expect(editor.querySelector("blockquote")).toBeNull();
    expect(visibleText(editor)).toContain("hello");
    expect(selectionInsideTag("BLOCKQUOTE")).toBe(false);

    editor.remove();
  });
});
