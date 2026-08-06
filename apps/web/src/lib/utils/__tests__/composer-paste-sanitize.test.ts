import { describe, expect, it } from "vitest";

import {
  composerPastedHtmlToPlainText,
  stripComposerInlineTextColors,
} from "@/lib/utils/composer-paste-sanitize";

describe("composerPastedHtmlToPlainText", () => {
  it("extracts text via DOMParser, not regex tag stripping", () => {
    expect(
      composerPastedHtmlToPlainText(
        '<span style="color: rgb(10, 10, 10)">hello <strong>world</strong></span>',
      ),
    ).toBe("hello world");
  });

  it("does not leave tag residue from nested brackets", () => {
    // Incomplete regex strip of /<[^>]+>/g can leave injectable residue;
    // textContent must never reintroduce markup as text-as-HTML.
    const text = composerPastedHtmlToPlainText(
      "<<script>alert(1)</script>visible",
    );
    expect(text).toContain("visible");
    expect(text).not.toMatch(/<script/i);
  });

  it("preserves line breaks from br tags", () => {
    expect(composerPastedHtmlToPlainText("a<br>b<br/>c")).toBe("a\nb\nc");
  });

  it("preserves line breaks between block elements", () => {
    expect(
      composerPastedHtmlToPlainText("<p>first</p><p>second</p>").trim(),
    ).toBe("first\nsecond");
  });

  it("collapses excessive blank lines from nested blocks", () => {
    const text = composerPastedHtmlToPlainText(
      "<div><p>one</p><p>two</p></div>",
    );
    expect(text).not.toMatch(/\n{3,}/);
    expect(text).toContain("one");
    expect(text).toContain("two");
  });
});

describe("stripComposerInlineTextColors", () => {
  it("clears color styles already in the editor DOM", () => {
    const root = document.createElement("div");
    root.innerHTML = '<span style="color: rgb(10, 10, 10);">asdasdas</span>';
    expect(stripComposerInlineTextColors(root)).toBe(true);
    expect(root.innerHTML).not.toMatch(/color\s*:/i);
    expect(root.textContent).toBe("asdasdas");
  });

  it("is a no-op when there are no color styles", () => {
    const root = document.createElement("div");
    root.innerHTML = "<strong>ok</strong>";
    expect(stripComposerInlineTextColors(root)).toBe(false);
    expect(root.innerHTML).toBe("<strong>ok</strong>");
  });
});
