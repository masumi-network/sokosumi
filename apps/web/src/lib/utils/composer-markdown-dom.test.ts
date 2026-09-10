import { describe, expect, it } from "vitest";

import {
  htmlToMarkdown,
  markdownToHtml,
  normalizeLooseInlineMarkdown,
  sanitizeComposerHtml,
  wrapInlineMarkdownMarker,
} from "@/lib/utils/composer-markdown-dom";

describe("markdownToHtml", () => {
  it("renders italic/bold/strike/code with markers removed from HTML", () => {
    const html = markdownToHtml("hello _world_ and **bold** ~~x~~ `c`");
    expect(html).toContain("<em>world</em>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<s>x</s>");
    expect(html).toContain("<code>c</code>");
    expect(html).not.toContain("_world_");
    expect(html).not.toContain("**bold**");
  });

  it("renders underline stored as <u> tags", () => {
    expect(markdownToHtml("say <u>hi</u>")).toContain("<u>hi</u>");
  });

  it("renders blockquotes from > lines", () => {
    expect(markdownToHtml("> quoted")).toContain(
      "<blockquote>quoted</blockquote>",
    );
  });

  it("wraps membership-visible channel links as chips", () => {
    const html = markdownToHtml("see #general please", undefined, {
      channelLinks: [{ name: "general", slug: "general" }],
    });
    expect(html).toContain('data-channel-label="general"');
    expect(html).toContain("#general");
    expect(html).not.toContain("[#general]");
  });

  it("leaves unknown mention persist tokens as raw text when wrapping is off", () => {
    const html = markdownToHtml("ping @missing:ghost hey", undefined, {
      wrapUnknownMentions: false,
    });
    expect(html).toContain("ping @missing:ghost hey");
    expect(html).not.toContain("data-mention-key");
  });

  it("wraps unknown mention persist tokens by default", () => {
    const html = markdownToHtml("ping @missing:ghost hey");
    expect(html).toContain("data-mention-key");
    expect(html).not.toContain("@missing:ghost");
  });

  it("wraps persisted internal mention placeholders as chips", () => {
    const html = markdownToHtml("@@MENTION1@@");
    expect(html).toContain("data-mention-key");
    expect(html).not.toContain("@@MENTION1@@");
  });

  it("still wraps @@MENTION salvage tokens when unknown wrapping is off", () => {
    const html = markdownToHtml("@@MENTION1@@", undefined, {
      wrapUnknownMentions: false,
    });
    expect(html).toContain('data-mention-key="unknown-mention-1"');
    expect(html).not.toContain("@@MENTION1@@");
  });

  it("wraps known mention persist tokens as display-name chips", () => {
    const html = markdownToHtml(
      "ping @user_1:alice-smith hey",
      (mentionKey, mentionSlug) =>
        mentionKey === "user_1"
          ? { displayName: "Alice Smith", isKnown: true }
          : { displayName: mentionSlug, isKnown: false },
    );
    expect(html).toContain("@Alice Smith");
    expect(html).toContain('data-mention-key="user_1"');
    expect(html).not.toContain("@user_1:alice-smith");
  });

  it("round-trips known mention chips back to persist tokens", () => {
    const source = "ping @user_1:alice-smith hey";
    const html = markdownToHtml(source, (mentionKey, mentionSlug) =>
      mentionKey === "user_1"
        ? { displayName: "Alice Smith", isKnown: true }
        : { displayName: mentionSlug, isKnown: false },
    );
    const root = document.createElement("div");
    root.innerHTML = html;
    expect(htmlToMarkdown(root)).toBe(source);
  });

  it("keeps allow-listed languages in the data-language attribute", () => {
    expect(markdownToHtml("```c++\ncode\n```")).toContain(
      'data-language="c++"',
    );
    expect(markdownToHtml("```c#\ncode\n```")).toContain('data-language="c#"');
    expect(markdownToHtml("```asp.net\ncode\n```")).toContain(
      'data-language="asp.net"',
    );
  });

  it("drops fence info strings that try to inject attributes", () => {
    const html = markdownToHtml('```" onmouseover="alert(1)\ncode\n```');
    const root = document.createElement("div");
    root.innerHTML = html;
    const code = root.querySelector("pre code");
    expect(code).not.toBeNull();
    expect(Array.from(code?.attributes ?? []).map((a) => a.name)).toEqual([]);
    expect(code?.textContent).toBe("code");
  });

  it("keeps quotes in link destinations from breaking out of href", () => {
    const html = markdownToHtml('[click](mailto:x"onmouseover="y)');
    const root = document.createElement("div");
    root.innerHTML = html;
    const anchor = root.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(Array.from(anchor?.attributes ?? []).map((a) => a.name)).toEqual([
      "href",
    ]);
    expect(anchor?.getAttribute("href")).toBe('mailto:x"onmouseover="y');
  });

  it("does not double-encode ampersands in link hrefs", () => {
    const html = markdownToHtml("[x](https://a.test/?b=1&c=2)");
    expect(html).toContain('href="https://a.test/?b=1&amp;c=2"');
    const root = document.createElement("div");
    root.innerHTML = html;
    expect(root.querySelector("a")?.getAttribute("href")).toBe(
      "https://a.test/?b=1&c=2",
    );
  });
});

describe("htmlToMarkdown", () => {
  function fromHtml(html: string): string {
    const root = document.createElement("div");
    root.innerHTML = html;
    return htmlToMarkdown(root);
  }

  it("round-trips inline formats to markdown markers", () => {
    expect(fromHtml("hello <em>world</em>")).toBe("hello _world_");
    expect(fromHtml("<strong>bold</strong>")).toBe("**bold**");
    expect(fromHtml("<s>gone</s>")).toBe("~~gone~~");
    expect(fromHtml("<code>c</code>")).toBe("`c`");
    expect(fromHtml("<u>hi</u>")).toBe("<u>hi</u>");
  });

  it("moves whitespace outside inline markers for CommonMark", () => {
    expect(fromHtml("<strong>bold </strong>")).toBe("**bold** ");
    expect(fromHtml("<em> hi</em>")).toBe(" _hi_");
    expect(fromHtml("<s>x </s>!")).toBe("~~x~~ !");
    expect(fromHtml("<u> under </u>")).toBe(" <u>under</u> ");
  });

  it("serializes blockquote with > prefix", () => {
    expect(fromHtml("<blockquote>quoted</blockquote>").trim()).toBe("> quoted");
  });

  it("serializes channel chips back to #name", () => {
    expect(
      fromHtml(
        '<span data-channel-label="Marketing" contenteditable="false">#Marketing</span>',
      ),
    ).toBe("#Marketing");
  });

  it("round-trips markdown → html → markdown for common wraps", () => {
    const source = "a _b_ **c** ~~d~~ `e` <u>f</u>";
    const html = markdownToHtml(source);
    const root = document.createElement("div");
    root.innerHTML = html;
    expect(htmlToMarkdown(root).trim()).toBe(source);
  });
});

describe("normalizeLooseInlineMarkdown", () => {
  it("moves spaces outside bold/italic/strike markers", () => {
    expect(normalizeLooseInlineMarkdown("asdasd **asdasd **")).toBe(
      "asdasd **asdasd** ",
    );
    expect(normalizeLooseInlineMarkdown("_hi _ there")).toBe("_hi_  there");
    expect(normalizeLooseInlineMarkdown("~~bye ~~")).toBe("~~bye~~ ");
    expect(normalizeLooseInlineMarkdown("**clean**")).toBe("**clean**");
  });
});

describe("wrapInlineMarkdownMarker", () => {
  it("keeps empty or whitespace-only content unmarked", () => {
    expect(wrapInlineMarkdownMarker("", "**", "**")).toBe("");
    expect(wrapInlineMarkdownMarker("   ", "**", "**")).toBe("   ");
  });
});

describe("sanitizeComposerHtml", () => {
  it("keeps every tag the composer emits", () => {
    const html =
      "<h1>a</h1><h2>b</h2><h3>c</h3><ul><li>d</li></ul><ol><li>e</li></ol>" +
      "<blockquote>f</blockquote><pre><code>g</code></pre>" +
      "<strong>h</strong><em>i</em><s>j</s><u>k</u><code>l</code><br>";
    const root = document.createElement("div");
    root.innerHTML = sanitizeComposerHtml(html);
    expect(
      Array.from(root.querySelectorAll("*")).map((element) =>
        element.tagName.toLowerCase(),
      ),
    ).toEqual([
      "h1",
      "h2",
      "h3",
      "ul",
      "li",
      "ol",
      "li",
      "blockquote",
      "pre",
      "code",
      "strong",
      "em",
      "s",
      "u",
      "code",
      "br",
    ]);
    expect(root.textContent).toBe("abcdefghijkl");
  });

  it("keeps the attributes htmlToMarkdown reads back", () => {
    const html =
      '<span data-mention-key="user_1" data-mention-slug="alice" ' +
      'class="text-primary" contenteditable="false">@Alice</span>' +
      '<span data-channel-label="general" contenteditable="false">#general</span>' +
      '<pre><code data-language="ts">x</code></pre>' +
      '<a href="https://a.test/">link</a>';
    const root = document.createElement("div");
    root.innerHTML = sanitizeComposerHtml(html);

    const mention = root.querySelector("[data-mention-key]");
    expect(mention?.getAttribute("data-mention-slug")).toBe("alice");
    expect(mention?.getAttribute("contenteditable")).toBe("false");
    expect(mention?.getAttribute("class")).toBe("text-primary");
    expect(
      root
        .querySelector("[data-channel-label]")
        ?.getAttribute("contenteditable"),
    ).toBe("false");
    expect(root.querySelector("code")?.getAttribute("data-language")).toBe(
      "ts",
    );
    expect(root.querySelector("a")?.getAttribute("href")).toBe(
      "https://a.test/",
    );
  });

  it("strips tags the composer never emits", () => {
    const sanitized = sanitizeComposerHtml(
      '<img src="x"><table><tr><td>t</td></tr></table><p>keep</p>',
    );
    expect(sanitized).not.toContain("<img");
    expect(sanitized).not.toContain("<table");
    expect(sanitized).toContain("keep");
  });

  it("strips scripts and event handlers", () => {
    const sanitized = sanitizeComposerHtml(
      '<script>alert(1)</script><strong onmouseover="alert(1)">hi</strong>' +
        '<img src=x onerror="alert(1)">',
    );
    const root = document.createElement("div");
    root.innerHTML = sanitized;
    expect(root.querySelector("script")).toBeNull();
    expect(root.querySelector("img")).toBeNull();
    expect(
      Array.from(root.querySelector("strong")?.attributes ?? []).map(
        (attribute) => attribute.name,
      ),
    ).toEqual([]);
  });

  it("strips javascript: hrefs while keeping http and mailto", () => {
    expect(
      sanitizeComposerHtml('<a href="javascript:alert(1)">x</a>'),
    ).not.toContain("javascript:");
    expect(sanitizeComposerHtml('<a href="mailto:a@b.test">x</a>')).toContain(
      "mailto:a@b.test",
    );
  });

  it("admits no void tag other than br", () => {
    // normalizeVoidTagSerialization rewrites only <br />. Any other void tag
    // in the allow-list would keep sanitize-html's XML-style serialization
    // and break the editors' skip-the-write guard.
    const voidTags = [
      "area",
      "base",
      "basefont",
      "col",
      "embed",
      "hr",
      "img",
      "input",
      "link",
      "meta",
      "param",
      "source",
      "track",
      "wbr",
    ];
    for (const tag of voidTags) {
      const sanitized = sanitizeComposerHtml(`<${tag}>`);
      expect(sanitized).toBe("");
    }
    expect(sanitizeComposerHtml("a<br>b")).toBe("a<br>b");
  });

  it("strips protocol-relative hrefs", () => {
    const root = document.createElement("div");
    root.innerHTML = sanitizeComposerHtml('<a href="//evil.test/x">x</a>');
    expect(root.querySelector("a")?.getAttribute("href")).toBeNull();
  });

  it("strips inline styles", () => {
    expect(
      sanitizeComposerHtml('<strong style="color:red">x</strong>'),
    ).not.toContain("style");
  });
});

describe("markdownToHtml sanitization boundary", () => {
  function roundTrip(
    source: string,
    resolve?: Parameters<typeof markdownToHtml>[1],
    options?: Parameters<typeof markdownToHtml>[2],
  ): string {
    const root = document.createElement("div");
    root.innerHTML = markdownToHtml(source, resolve, options);
    return htmlToMarkdown(root).trim();
  }

  it("round-trips a known mention chip", () => {
    const source = "ping @user_1:alice-smith hey";
    expect(
      roundTrip(source, (mentionKey, mentionSlug) =>
        mentionKey === "user_1"
          ? { displayName: "Alice Smith", isKnown: true }
          : { displayName: mentionSlug, isKnown: false },
      ),
    ).toBe(source);
  });

  it("round-trips an unknown mention chip", () => {
    const source = "ping @missing:ghost hey";
    expect(roundTrip(source)).toBe(source);
  });

  it("round-trips a channel link chip", () => {
    expect(
      roundTrip("see #general please", undefined, {
        channelLinks: [{ name: "general", slug: "general" }],
      }),
    ).toBe("see #general please");
  });

  it("round-trips fenced code with and without a language", () => {
    expect(roundTrip("```ts\nconst a = 1;\n```")).toBe(
      "```ts\nconst a = 1;\n```",
    );
    expect(roundTrip("```\nplain\n```")).toBe("```\nplain\n```");
  });

  it("round-trips links", () => {
    expect(roundTrip("[x](https://a.test/)")).toBe("[x](https://a.test/)");
    expect(roundTrip("[mail](mailto:a@b.test)")).toBe(
      "[mail](mailto:a@b.test)",
    );
  });

  it("round-trips every inline format", () => {
    const source = "a _b_ **c** ~~d~~ `e` <u>f</u>";
    expect(roundTrip(source)).toBe(source);
  });

  it("keeps chips non-editable after sanitization", () => {
    const root = document.createElement("div");
    root.innerHTML = markdownToHtml(
      "hi @missing:ghost and #general",
      undefined,
      {
        channelLinks: [{ name: "general", slug: "general" }],
      },
    );
    const chips = root.querySelectorAll(
      "[data-mention-key], [data-channel-label]",
    );
    expect(chips).toHaveLength(2);
    for (const chip of Array.from(chips)) {
      expect(chip.getAttribute("contenteditable")).toBe("false");
    }
  });

  it("serializes markup as the browser does, so the editors can skip a write", () => {
    // Both composers guard their innerHTML write with
    // `editor.innerHTML !== markdownToHtml(value)`. A serialization the
    // browser rewrites makes that guard never hold. Scope is markup only:
    // a non-breaking space in the text still re-serializes to &nbsp;, which
    // predates the sanitizer and is not fixed here.
    const sources = [
      "a\nb",
      "# h",
      "- a\n- b",
      "1. one",
      "> q",
      "```\nx\n```",
      "**b** _i_ ~~s~~ `c` <u>u</u>",
      "[x](https://a.test/)",
      "hi @missing:ghost",
    ];
    for (const source of sources) {
      const html = markdownToHtml(source);
      const root = document.createElement("div");
      root.innerHTML = html;
      expect(root.innerHTML).toBe(html);
    }
  });

  it("renders headings, lists and blockquotes through the boundary", () => {
    const root = document.createElement("div");
    root.innerHTML = markdownToHtml("# h\n## h2\n- a\n1. one\n> q");
    expect(root.querySelector("h1")?.textContent).toBe("h");
    expect(root.querySelector("h2")?.textContent).toBe("h2");
    expect(root.querySelector("ul li")?.textContent).toBe("a");
    expect(root.querySelector("ol li")?.textContent).toBe("one");
    expect(root.querySelector("blockquote")?.textContent).toBe("q");
  });

  it("does not double-encode entities the escape pass already produced", () => {
    expect(roundTrip("a & b < c")).toBe("a & b < c");
    expect(roundTrip("```\na & b < c\n```")).toBe("```\na & b < c\n```");
    expect(roundTrip("[a & b](https://a.test/)")).toBe(
      "[a & b](https://a.test/)",
    );
  });

  it("strips attributes a restored token injects into a chip", () => {
    // The mention slug swallows the link placeholder, so the link HTML is
    // restored inside an attribute value where the element-context escaping
    // does not apply. Without the boundary the browser reads `https:` and
    // `y.test` off the chip as bare attributes.
    const root = document.createElement("div");
    root.innerHTML = markdownToHtml("@a:b[x](https://y.test/)");
    const chip = root.querySelector("[data-mention-key]");
    expect(chip).not.toBeNull();
    expect(
      Array.from(chip?.attributes ?? []).map((attribute) => attribute.name),
    ).toEqual(["data-mention-key", "data-mention-slug"]);
  });

  it("renders literal HTML text as text", () => {
    const html = markdownToHtml("<script>alert(1)</script>");
    const root = document.createElement("div");
    root.innerHTML = html;
    expect(root.querySelector("script")).toBeNull();
    expect(root.textContent).toBe("<script>alert(1)</script>");
  });
});
