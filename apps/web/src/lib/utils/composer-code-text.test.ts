import { describe, expect, it } from "vitest";

import { readComposerCodeText } from "@/lib/utils/composer-code-text";

function read(html: string): string {
  const pre = document.createElement("pre");
  pre.innerHTML = html;
  return readComposerCodeText(pre);
}

describe("readComposerCodeText", () => {
  it("reads a plain code block", () => {
    expect(read("<code>hello world</code>")).toBe("hello world");
  });

  it("reads br as a newline", () => {
    expect(read("<code>first<br>second</code>")).toBe("first\nsecond");
  });

  it("reads div-split lines as newlines", () => {
    expect(read("<code><div>line 1</div><div>line 2</div></code>")).toBe(
      "line 1\nline 2",
    );
  });

  it("reads text parked beside the code element", () => {
    // contentEditable puts typed text here when the caret sits on the `pre`.
    expect(read("what about now.<code></code>")).toBe("what about now.");
  });

  it("drops a trailing break, which contentEditable adds as scaffolding", () => {
    expect(read("<code>only line<br></code>")).toBe("only line");
  });

  it("reads an empty block as empty", () => {
    expect(read("<code><br></code>")).toBe("");
  });

  it("keeps a blank last line that comes from text", () => {
    // Markdown-sourced fences carry their newlines in the text node, so a
    // trailing one is the author's blank line, not scaffolding.
    expect(read("<code>foo\n</code>")).toBe("foo\n");
  });

  it("strips zero-width spaces", () => {
    expect(read("<code>a\u200bb</code>")).toBe("ab");
  });
});
