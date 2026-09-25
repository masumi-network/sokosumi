import { describe, expect, it, vi } from "vitest";

vi.mock("mermaid", () => ({ default: {} }));
// happy-dom does not faithfully implement DOMPurify's SVG traversal. Exercise
// the resource guard here; real sanitization is covered by the browser harness.
vi.mock("dompurify", () => ({ default: { sanitize: (svg: string) => svg } }));

import { sanitizeMermaidSvg } from "./render-mermaid";

describe("untrusted SVG output", () => {
  it("rejects external resources before sanitization", () => {
    expect(() =>
      sanitizeMermaidSvg('<svg><image href="https://evil.test"/></svg>'),
    ).toThrow("Unsafe SVG resource");
  });
  it("rejects an empty sanitizer result", () => {
    expect(() => sanitizeMermaidSvg("<script>alert(1)</script>")).toThrow(
      "Invalid SVG output",
    );
  });
  it.each([
    '<style>@import "https://evil.test";</style>',
    '<path style="fill:url(https://evil.test)"/>',
    "<style>text{fill:u\\72l(//evil.test)}</style>",
  ])("rejects CSS resources: %s", (payload) => {
    expect(() => sanitizeMermaidSvg(`<svg>${payload}</svg>`)).toThrow(
      "Unsafe SVG resource",
    );
  });
  it("retains local arrow markers", () => {
    expect(
      sanitizeMermaidSvg('<svg><path marker-end="url(#arrow-1)"/></svg>'),
    ).toContain("url(#arrow-1)");
  });
});
