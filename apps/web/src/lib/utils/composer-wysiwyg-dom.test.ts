import { afterEach, describe, expect, it, vi } from "vitest";

import {
  composerCaretScrollDelta,
  isInsideComposerProtectedContext,
  replaceComposerTextRange,
  scrollComposerCaretIntoView,
} from "@/lib/utils/composer-wysiwyg-dom";

describe("isInsideComposerProtectedContext", () => {
  it("returns true for nodes inside CODE/PRE", () => {
    const root = document.createElement("div");
    const code = document.createElement("code");
    const text = document.createTextNode(":D ");
    code.appendChild(text);
    root.appendChild(code);

    expect(isInsideComposerProtectedContext(text, root)).toBe(true);
    expect(isInsideComposerProtectedContext(code, root)).toBe(true);
  });

  it("returns true for nodes inside a mention chip", () => {
    const root = document.createElement("div");
    const mention = document.createElement("span");
    mention.dataset.mentionKey = "alice";
    mention.dataset.mentionSlug = "alice";
    const text = document.createTextNode("@Alice");
    mention.appendChild(text);
    root.appendChild(mention);

    expect(isInsideComposerProtectedContext(text, root)).toBe(true);
    expect(isInsideComposerProtectedContext(mention, root)).toBe(true);
  });

  it("returns false for plain text under root", () => {
    const root = document.createElement("div");
    const text = document.createTextNode("hi :D ");
    root.appendChild(text);

    expect(isInsideComposerProtectedContext(text, root)).toBe(false);
    expect(isInsideComposerProtectedContext(root, root)).toBe(false);
  });
});

describe("replaceComposerTextRange", () => {
  it("replaces a plain range and leaves caret after insert", () => {
    const editor = document.createElement("div");
    editor.textContent = "hi :D ";
    document.body.appendChild(editor);

    expect(replaceComposerTextRange(editor, 3, 6, "😄 ")).toBe(true);
    expect(editor.textContent).toBe("hi 😄 ");

    const selection = window.getSelection();
    const range = selection?.getRangeAt(0);
    expect(range?.collapsed).toBe(true);
    expect(range?.startOffset).toBe(range?.startContainer.textContent?.length);

    document.body.removeChild(editor);
  });

  it("skips replace when range endpoints sit in CODE", () => {
    const editor = document.createElement("div");
    editor.innerHTML = "hello<code>:D</code> ";
    document.body.appendChild(editor);

    // serialize "hello:D " — `:D` is at 5..7
    expect(replaceComposerTextRange(editor, 5, 7, "😄")).toBe(false);
    expect(editor.querySelector("code")?.textContent).toBe(":D");
    expect(editor.textContent).toContain(":D");

    document.body.removeChild(editor);
  });

  it("skips replace when range fully encloses a mention chip", () => {
    const editor = document.createElement("div");
    // "a " + mention token @alice:alice (12 chars) + " b" → total serialized length
    // Token length = "@alice:alice".length = 12
    editor.innerHTML =
      'a <span data-mention-key="alice" data-mention-slug="alice" contenteditable="false">@Alice</span> b';
    document.body.appendChild(editor);

    // Range covering "a " (0-2) through end of mention (2+12=14) into " b"
    // would wipe the chip if we only checked endpoints.
    expect(replaceComposerTextRange(editor, 0, 14, "gone")).toBe(false);
    expect(editor.querySelector("[data-mention-key='alice']")).not.toBeNull();
    expect(editor.textContent).toContain("@Alice");

    document.body.removeChild(editor);
  });

  it("allows replace of plain text after a mention chip", () => {
    const editor = document.createElement("div");
    editor.innerHTML =
      '<span data-mention-key="alice" data-mention-slug="alice" contenteditable="false">@Alice</span> :D ';
    document.body.appendChild(editor);

    // serialize: "@alice:alice :D " — ":D " starts after 12-char token + space = 13
    expect(replaceComposerTextRange(editor, 13, 16, "😄 ")).toBe(true);
    expect(editor.querySelector("[data-mention-key='alice']")).not.toBeNull();
    expect(editor.textContent).toContain("😄");
    expect(editor.textContent).not.toContain(":D");

    document.body.removeChild(editor);
  });
});

describe("composerCaretScrollDelta", () => {
  it("scrolls down when the caret sits below the content box", () => {
    expect(
      composerCaretScrollDelta({
        caretTop: 183,
        caretBottom: 200,
        visibleTop: 14,
        visibleBottom: 150,
      }),
    ).toBe(50);
  });

  it("scrolls up when the caret sits above the content box", () => {
    expect(
      composerCaretScrollDelta({
        caretTop: 0,
        caretBottom: 17,
        visibleTop: 14,
        visibleBottom: 150,
      }),
    ).toBe(-14);
  });

  it("does not scroll when the caret is fully inside the content box", () => {
    expect(
      composerCaretScrollDelta({
        caretTop: 40,
        caretBottom: 57,
        visibleTop: 14,
        visibleBottom: 150,
      }),
    ).toBe(0);
  });

  it("does not scroll when the caret is flush with the content bottom", () => {
    expect(
      composerCaretScrollDelta({
        caretTop: 133,
        caretBottom: 150,
        visibleTop: 14,
        visibleBottom: 150,
      }),
    ).toBe(0);
  });
});

describe("scrollComposerCaretIntoView", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function rect(top: number, bottom: number): DOMRect {
    return {
      top,
      bottom,
      left: 0,
      right: 100,
      width: 100,
      height: bottom - top,
      x: 0,
      y: top,
      toJSON() {
        return {};
      },
    };
  }

  it("increases scrollTop when the caret sits below the content box", () => {
    const editor = document.createElement("div");
    editor.textContent = "hello";
    document.body.appendChild(editor);
    Object.defineProperty(editor, "scrollTop", {
      configurable: true,
      writable: true,
      value: 0,
    });

    const text = editor.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, text.length);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    vi.spyOn(editor, "getBoundingClientRect").mockReturnValue(rect(0, 160));
    vi.spyOn(Range.prototype, "getClientRects").mockReturnValue([
      rect(183, 200),
    ] as unknown as DOMRectList);
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      paddingTop: "14px",
      paddingBottom: "10px",
    } as CSSStyleDeclaration);

    scrollComposerCaretIntoView(editor);

    expect(editor.scrollTop).toBe(50);
    document.body.removeChild(editor);
  });

  it("does not mutate the editor when the caret is already in view", () => {
    const editor = document.createElement("div");
    editor.textContent = "hello";
    document.body.appendChild(editor);
    Object.defineProperty(editor, "scrollTop", {
      configurable: true,
      writable: true,
      value: 12,
    });

    const text = editor.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, text.length);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    vi.spyOn(editor, "getBoundingClientRect").mockReturnValue(rect(0, 160));
    vi.spyOn(Range.prototype, "getClientRects").mockReturnValue([
      rect(40, 57),
    ] as unknown as DOMRectList);
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      paddingTop: "14px",
      paddingBottom: "10px",
    } as CSSStyleDeclaration);

    const htmlBefore = editor.innerHTML;
    scrollComposerCaretIntoView(editor);

    expect(editor.scrollTop).toBe(12);
    expect(editor.innerHTML).toBe(htmlBefore);
    document.body.removeChild(editor);
  });
});
