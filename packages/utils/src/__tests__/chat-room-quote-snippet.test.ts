import { describe, expect, it } from "vitest";
import {
  buildQuoteSnippet,
  QUOTE_SNIPPET_MAX_CHARS,
} from "../chat-room-quote-snippet";

describe("buildQuoteSnippet", () => {
  it("strips light markdown and collapses whitespace", () => {
    expect(buildQuoteSnippet("**hello**  [link](https://x.test)  world")).toBe(
      "hello link world",
    );
  });

  it("truncates long snippets with an ellipsis", () => {
    const long = `**bold** and [link](https://x.test) ${"a".repeat(300)}`;
    const snippet = buildQuoteSnippet(long);
    expect(snippet.startsWith("bold and link ")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(QUOTE_SNIPPET_MAX_CHARS + 1);
  });
});
