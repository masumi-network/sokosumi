import { describe, expect, it } from "vitest";

import {
  sanitizeComposerPastedHtml,
  stripComposerInlineTextColors,
} from "@/lib/utils/composer-paste-sanitize";

describe("sanitizeComposerPastedHtml", () => {
  it("strips inline color so dark-mode paste is not invisible", () => {
    const html =
      '<span style="color: rgb(10, 10, 10);">https://x.com/status/1 asdasdas</span>';
    const sanitized = sanitizeComposerPastedHtml(html);
    expect(sanitized).not.toMatch(/color\s*:/i);
    expect(sanitized).toContain("https://x.com/status/1 asdasdas");
  });

  it("keeps non-color styles and formatting tags", () => {
    const html =
      '<strong style="color: #0a0a0a; font-weight: 700">bold</strong>';
    const sanitized = sanitizeComposerPastedHtml(html);
    expect(sanitized).toContain("<strong");
    expect(sanitized).toContain("font-weight: 700");
    expect(sanitized).not.toMatch(/color\s*:/i);
  });

  it("removes font color attributes", () => {
    const sanitized = sanitizeComposerPastedHtml(
      '<font color="#111111">dark</font>',
    );
    expect(sanitized).not.toMatch(/color=/i);
    expect(sanitized).toContain("dark");
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
