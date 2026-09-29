import { describe, expect, it } from "vitest";

import { buildFileSnippet, SNIPPET_MAX_CHARS } from "./snippet";

describe("buildFileSnippet", () => {
  it("returns the passage unchanged when it already fits", () => {
    const snippet = buildFileSnippet({
      text: "Aurora research about bicycle commuters.",
      query: "commuters",
    });
    expect(snippet.text).toBe("Aurora research about bicycle commuters.");
    expect(snippet.truncatedStart).toBe(false);
    expect(snippet.truncatedEnd).toBe(false);
  });

  it("highlights offsets into the text it returns, not into the source", () => {
    const filler = "padding ".repeat(60);
    const snippet = buildFileSnippet({
      text: `${filler}commuters matter${filler}`,
      query: "commuters",
    });
    expect(snippet.text.length).toBeLessThanOrEqual(SNIPPET_MAX_CHARS);
    expect(snippet.highlights.length).toBeGreaterThan(0);
    const [first] = snippet.highlights;
    expect(snippet.text.slice(first.start, first.end)).toBe("commuters");
  });

  it("marks both ends when the window sits inside a longer passage", () => {
    const filler = "padding ".repeat(60);
    const snippet = buildFileSnippet({
      text: `${filler}commuters${filler}`,
      query: "commuters",
    });
    expect(snippet.truncatedStart).toBe(true);
    expect(snippet.truncatedEnd).toBe(true);
  });

  it("returns markup as plain text so nothing renders as HTML", () => {
    const snippet = buildFileSnippet({
      text: '<script>alert("x")</script> aurora',
      query: "aurora",
    });
    expect(snippet.text).toContain("<script>");
    expect(snippet.text).not.toContain("&lt;");
  });

  it("merges overlapping term matches into one span", () => {
    const snippet = buildFileSnippet({
      text: "commuter commuters",
      query: "commuter commuters",
    });
    expect(snippet.highlights).toHaveLength(2);
  });

  it("falls back to the leading window with no query", () => {
    const snippet = buildFileSnippet({
      text: "a".repeat(1_000),
      query: null,
    });
    expect(snippet.text.length).toBeLessThanOrEqual(SNIPPET_MAX_CHARS);
    expect(snippet.truncatedStart).toBe(false);
    expect(snippet.truncatedEnd).toBe(true);
    expect(snippet.highlights).toHaveLength(0);
  });
});
