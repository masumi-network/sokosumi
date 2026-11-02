import { describe, expect, it } from "vitest";
import {
  buildRoomQuoteSnippetParts,
  cleanChatMessageText,
} from "./chat-room-quote-snippet";

describe("buildRoomQuoteSnippetParts snippet", () => {
  it("strips light markdown and collapses horizontal whitespace", () => {
    expect(
      buildRoomQuoteSnippetParts("**hello**  [link](https://x.test)  world")
        .snippet,
    ).toBe("hello link world");
  });

  it("preserves newlines from the original message", () => {
    expect(
      buildRoomQuoteSnippetParts(
        "Two more things about the chat here:\nCan you please add @all:all tagging.",
      ).snippet,
    ).toBe(
      "Two more things about the chat here:\nCan you please add @all:all tagging.",
    );
  });

  it("collapses spaces and tabs on a line without joining paragraphs", () => {
    expect(buildRoomQuoteSnippetParts("hello \t  world\n\nnext").snippet).toBe(
      "hello world\n\nnext",
    );
  });

  it("leaves mention tokens intact for the render layer", () => {
    expect(
      buildRoomQuoteSnippetParts("ping @user-1:alice and @all:all").snippet,
    ).toBe("ping @user-1:alice and @all:all");
  });

  it("keeps the full cleaned message without truncating", () => {
    const long = `**bold** and [link](https://x.test) ${"a".repeat(300)}`;
    const snippet = buildRoomQuoteSnippetParts(long).snippet;
    expect(snippet.startsWith("bold and link ")).toBe(true);
    expect(snippet.endsWith("a")).toBe(true);
    expect(snippet).not.toContain("…");
    expect(snippet.length).toBeGreaterThan(300);
  });
});

describe("buildRoomQuoteSnippetParts", () => {
  const notes = {
    fileName: "notes.pdf",
    url: "https://blob.example/notes.pdf",
    mediaKind: "file",
  };
  const shot = {
    fileName: "shot.png",
    url: "https://blob.example/shot.png",
    mediaKind: "image",
  };

  it("lifts every file link out of the snippet, in body order", () => {
    expect(
      buildRoomQuoteSnippetParts(
        "look at this\n\n[a.png](https://blob.example/a.png)\n[b.png](https://blob.example/b.png)\n[c.png](https://blob.example/c.png)\n[d.png](https://blob.example/d.png)",
      ),
    ).toMatchObject({
      snippet: "look at this",
      attachments: ["a", "b", "c", "d"].map((name) => ({
        fileName: `${name}.png`,
        url: `https://blob.example/${name}.png`,
        mediaKind: "image",
      })),
    });
  });

  it("lists a file linked twice once and removes both links", () => {
    const parts = buildRoomQuoteSnippetParts(
      "[shot.png](https://blob.example/shot.png) again [shot.png](https://blob.example/shot.png)",
    );
    expect(parts.snippet).toBe("again");
    expect(parts.attachments).toEqual([shot]);
  });

  it("prefers the first image-like file link as attachment", () => {
    expect(
      buildRoomQuoteSnippetParts(
        "see [notes.pdf](https://blob.example/notes.pdf) and [shot.png](https://blob.example/shot.png)",
      ),
    ).toEqual({
      snippet: "see and",
      attachment: shot,
      attachments: [notes, shot],
    });
  });

  it("falls back to the first file-like link when no image exists", () => {
    const spec = {
      fileName: "spec.pdf",
      url: "https://blob.example/spec.pdf",
      mediaKind: "file",
    };
    expect(
      buildRoomQuoteSnippetParts(
        "docs [spec.pdf](https://blob.example/spec.pdf) then [more.txt](https://blob.example/more.txt)",
      ),
    ).toEqual({
      snippet: "docs then",
      attachment: spec,
      attachments: [
        spec,
        {
          fileName: "more.txt",
          url: "https://blob.example/more.txt",
          mediaKind: "file",
        },
      ],
    });
  });

  it("excludes attachment link text from snippet so filename is not the only cue", () => {
    const launch = {
      fileName: "launch.png",
      url: "https://blob.example/launch.png",
      mediaKind: "image",
    };
    expect(
      buildRoomQuoteSnippetParts(
        "[launch.png](https://blob.example/launch.png)",
      ),
    ).toEqual({
      snippet: "",
      attachment: launch,
      attachments: [launch],
    });
  });

  it("keeps non-file markdown links in the snippet and leaves attachment null", () => {
    expect(
      buildRoomQuoteSnippetParts("check [docs](https://example.com/docs)"),
    ).toEqual({
      snippet: "check docs",
      attachment: null,
      attachments: [],
    });
  });

  it("uses the markdown link label as fileName", () => {
    const pretty = {
      fileName: "Pretty Name.png",
      url: "https://blob.example/raw.png",
      mediaKind: "image",
    };
    expect(
      buildRoomQuoteSnippetParts(
        "cap [Pretty Name.png](https://blob.example/raw.png)",
      ),
    ).toEqual({
      snippet: "cap",
      attachment: pretty,
      attachments: [pretty],
    });
  });
});

describe("cleanChatMessageText", () => {
  /**
   * CommonMark does not open emphasis on an underscore flanked by word
   * characters, so an env var name is literal text and has to survive.
   */
  it("keeps intraword underscores in an env var name", () => {
    expect(
      cleanChatMessageText(
        "I see it seems to be the COMPOSIO_X_AUTH_CONFIG_ID, correct?",
      ),
    ).toBe("I see it seems to be the COMPOSIO_X_AUTH_CONFIG_ID, correct?");
  });

  it("keeps intraword underscores inside emphasis", () => {
    expect(cleanChatMessageText("**COMPOSIO_X_AUTH_CONFIG_ID** is unset")).toBe(
      "COMPOSIO_X_AUTH_CONFIG_ID is unset",
    );
  });

  it("still strips underscore emphasis around a word", () => {
    expect(cleanChatMessageText("this is _very_ important")).toBe(
      "this is very important",
    );
  });

  /**
   * A `+` gives characters back to a lookahead, so matching an underscore run
   * from the middle deleted `foo__bar` while the room still printed both.
   */
  it("keeps a doubled underscore between words", () => {
    expect(cleanChatMessageText("use foo__bar here")).toBe("use foo__bar here");
  });

  it("keeps an underscore between non-ascii letters", () => {
    expect(cleanChatMessageText("变量_名")).toBe("变量_名");
  });

  it("still strips strong underscore emphasis", () => {
    expect(cleanChatMessageText("call __init__ now")).toBe("call init now");
  });

  /**
   * A label stops at a bracket, so an unclosed `[` in front of a link is not
   * read as the start of that link's label. Reading it that way would put the
   * words of the broken bracket inside the label and drop the real one.
   */
  it("reads a link whose label is preceded by an unclosed bracket", () => {
    expect(cleanChatMessageText("see [a [b](https://e.test/x)")).toBe(
      "see [a b",
    );
  });
});
