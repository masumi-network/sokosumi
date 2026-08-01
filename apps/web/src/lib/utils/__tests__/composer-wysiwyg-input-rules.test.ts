import { describe, expect, it } from "vitest";

import {
  matchComposerInputRule,
  resolveComposerEnterAction,
  tryApplyComposerInputRuleAtCaret,
} from "@/lib/utils/composer-wysiwyg-input-rules";

describe("matchComposerInputRule", () => {
  it("matches italic closing underscore", () => {
    expect(matchComposerInputRule("_asds_")).toEqual({
      format: "italic",
      matchStart: 0,
      matchEnd: 6,
      inner: "asds",
      openDelimiter: "_",
      closeDelimiter: "_",
      htmlTag: "em",
    });
  });

  it("matches bold, strike, and code", () => {
    expect(matchComposerInputRule("**hi**")?.format).toBe("bold");
    expect(matchComposerInputRule("~~bye~~")?.format).toBe("strike");
    expect(matchComposerInputRule("`x`")?.format).toBe("code");
  });

  it("rejects empty or multiline inners", () => {
    expect(matchComposerInputRule("__")).toBeNull();
    expect(matchComposerInputRule("**")).toBeNull();
    expect(matchComposerInputRule("_\n_")).toBeNull();
  });

  it("rejects mid-word underscores", () => {
    expect(matchComposerInputRule("a_b_")).toBeNull();
  });
});

describe("resolveComposerEnterAction", () => {
  it("submits on plain Enter on desktop", () => {
    expect(
      resolveComposerEnterAction({
        isNarrowViewport: false,
        shiftKey: false,
        metaKey: false,
        ctrlKey: false,
        isMentionKeyboardActive: false,
      }),
    ).toBe("submit");
  });

  it("inserts newline on Shift/Cmd/Ctrl+Enter and on mobile", () => {
    expect(
      resolveComposerEnterAction({
        isNarrowViewport: false,
        shiftKey: true,
        metaKey: false,
        ctrlKey: false,
        isMentionKeyboardActive: false,
      }),
    ).toBe("newline");
    expect(
      resolveComposerEnterAction({
        isNarrowViewport: false,
        shiftKey: false,
        metaKey: true,
        ctrlKey: false,
        isMentionKeyboardActive: false,
      }),
    ).toBe("newline");
    expect(
      resolveComposerEnterAction({
        isNarrowViewport: true,
        shiftKey: false,
        metaKey: false,
        ctrlKey: false,
        isMentionKeyboardActive: false,
      }),
    ).toBe("newline");
  });

  it("ignores Enter while mention keyboard is active", () => {
    expect(
      resolveComposerEnterAction({
        isNarrowViewport: false,
        shiftKey: false,
        metaKey: false,
        ctrlKey: false,
        isMentionKeyboardActive: true,
      }),
    ).toBe("ignore");
  });
});

describe("tryApplyComposerInputRuleAtCaret", () => {
  it("converts _text_ into an em element and hides markers", () => {
    const root = document.createElement("div");
    const textNode = document.createTextNode("_asds_");
    root.appendChild(textNode);
    document.body.appendChild(root);

    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode, 6);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(tryApplyComposerInputRuleAtCaret(root)).toBe(true);
    expect(root.querySelector("em")?.textContent).toBe("asds");
    expect(root.textContent?.replace(/\u200b/g, "")).toBe("asds");
    expect(root.innerHTML).not.toContain("_");
    expect(root.querySelector("[data-composer-exit='1']")).toBeTruthy();

    root.remove();
  });

  it("skips conversion inside code", () => {
    const root = document.createElement("div");
    const code = document.createElement("code");
    const textNode = document.createTextNode("_x_");
    code.appendChild(textNode);
    root.appendChild(code);
    document.body.appendChild(root);

    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode, 3);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(tryApplyComposerInputRuleAtCaret(root)).toBe(false);
    expect(root.textContent).toBe("_x_");

    root.remove();
  });

  it("leaves caret outside code after closing backtick so typing stays plain", () => {
    const root = document.createElement("div");
    root.contentEditable = "true";
    const textNode = document.createTextNode("`code`");
    root.appendChild(textNode);
    document.body.appendChild(root);

    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode, 6);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(tryApplyComposerInputRuleAtCaret(root)).toBe(true);

    const code = root.querySelector("code");
    expect(code?.textContent).toBe("code");
    expect(root.querySelector("[data-composer-exit='1']")).toBeTruthy();

    let node: Node | null | undefined = selection?.anchorNode;
    let insideCode = false;
    while (node) {
      if (node instanceof HTMLElement && node.tagName === "CODE") {
        insideCode = true;
        break;
      }
      node = node.parentNode;
    }
    expect(insideCode).toBe(false);

    // Simulate continued typing at the caret — must not land inside <code>.
    const typed = document.createTextNode(" asdasd");
    const anchor = selection?.anchorNode;
    const offset = selection?.anchorOffset ?? 0;
    expect(anchor).toBeTruthy();
    if (anchor?.nodeType === Node.TEXT_NODE) {
      const text = anchor.textContent ?? "";
      anchor.textContent = `${text.slice(0, offset)} asdasd${text.slice(offset)}`;
    } else if (anchor instanceof HTMLElement) {
      anchor.appendChild(typed);
    }
    expect(code?.textContent).toBe("code");
    expect(root.textContent?.replace(/\u200b/g, "")).toContain(" asdasd");

    root.remove();
  });
});
