import { describe, expect, it } from "vitest";
import {
  buildQuoteSnippet,
  buildRoomQuoteSnippetParts,
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

  it("keeps the full cleaned message without truncating", () => {
    const long = `**bold** and [link](https://x.test) ${"a".repeat(300)}`;
    const snippet = buildQuoteSnippet(long);
    expect(snippet.startsWith("bold and link ")).toBe(true);
    expect(snippet.endsWith("a")).toBe(true);
    expect(snippet).not.toContain("…");
    expect(snippet.length).toBeGreaterThan(300);
  });
});

describe("buildRoomQuoteSnippetParts", () => {
  it("prefers the first image-like file link as attachment", () => {
    expect(
      buildRoomQuoteSnippetParts(
        "see [notes.pdf](https://blob.example/notes.pdf) and [shot.png](https://blob.example/shot.png)",
      ),
    ).toEqual({
      snippet: "see notes.pdf and",
      attachment: {
        fileName: "shot.png",
        url: "https://blob.example/shot.png",
        mediaKind: "image",
      },
    });
  });

  it("falls back to the first file-like link when no image exists", () => {
    expect(
      buildRoomQuoteSnippetParts(
        "docs [spec.pdf](https://blob.example/spec.pdf) then [more.txt](https://blob.example/more.txt)",
      ),
    ).toEqual({
      snippet: "docs then more.txt",
      attachment: {
        fileName: "spec.pdf",
        url: "https://blob.example/spec.pdf",
        mediaKind: "file",
      },
    });
  });

  it("excludes attachment link text from snippet so filename is not the only cue", () => {
    expect(
      buildRoomQuoteSnippetParts(
        "[launch.png](https://blob.example/launch.png)",
      ),
    ).toEqual({
      snippet: "",
      attachment: {
        fileName: "launch.png",
        url: "https://blob.example/launch.png",
        mediaKind: "image",
      },
    });
  });

  it("keeps non-file markdown links in the snippet and leaves attachment null", () => {
    expect(
      buildRoomQuoteSnippetParts("check [docs](https://example.com/docs)"),
    ).toEqual({
      snippet: "check docs",
      attachment: null,
    });
  });

  it("uses the markdown link label as fileName", () => {
    expect(
      buildRoomQuoteSnippetParts(
        "cap [Pretty Name.png](https://blob.example/raw.png)",
      ),
    ).toEqual({
      snippet: "cap",
      attachment: {
        fileName: "Pretty Name.png",
        url: "https://blob.example/raw.png",
        mediaKind: "image",
      },
    });
  });
});
