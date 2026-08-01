import { describe, expect, it } from "vitest";
import {
  buildQuoteSnippet,
  QUOTE_SNIPPET_MAX_CHARS,
} from "../chat-room-quote-snippet";

describe("buildQuoteSnippet", () => {
  it("strips light markdown and collapses horizontal whitespace", () => {
    expect(buildQuoteSnippet("**hello**  [link](https://x.test)  world")).toBe(
      "hello link world",
    );
  });

  it("preserves newlines from the original message", () => {
    expect(
      buildQuoteSnippet(
        "Two more things about the chat here:\nCan you please add @all:all tagging.",
      ),
    ).toBe(
      "Two more things about the chat here:\nCan you please add @all:all tagging.",
    );
  });

  it("collapses spaces and tabs on a line without joining paragraphs", () => {
    expect(buildQuoteSnippet("hello \t  world\n\nnext")).toBe(
      "hello world\n\nnext",
    );
  });

  it("leaves mention tokens intact for the render layer", () => {
    expect(buildQuoteSnippet("ping @user-1:alice and @all:all")).toBe(
      "ping @user-1:alice and @all:all",
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
