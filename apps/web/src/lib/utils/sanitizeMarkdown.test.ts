import { describe, expect, it } from "vitest";
import { sanitizeMarkdown } from "@/lib/utils/sanitizeMarkdown";

describe("sanitizeMarkdown", () => {
  it("preserves HTML tags inside fenced code blocks", () => {
    const markdown = ["```html", "<div>hi</div>", "```"].join("\n");

    const sanitized = sanitizeMarkdown(markdown);

    expect(sanitized).toContain("```html\n<div>hi</div>\n```");
  });

  it("sanitizes HTML outside fenced code blocks", () => {
    const markdown = [
      "```html",
      "<div>safe inside code</div>",
      "```",
      "",
      "<script>alert('xss')</script>",
    ].join("\n");

    const sanitized = sanitizeMarkdown(markdown);

    expect(sanitized).toContain("```html\n<div>safe inside code</div>\n```");
    expect(sanitized).not.toContain("<script>");
  });

  // A code span is not lifted out the way a fence is. Whether backticks make
  // a span is the markdown parser's call, so everything between them is
  // sanitized, and `remarkRestoreInlineCodeEntities` undoes the entities once
  // the parser has said which spans are real.
  it("leaves the entities in a code span for the parsed tree to undo", () => {
    expect(sanitizeMarkdown("`a && b < c`")).toBe("`a &amp;&amp; b &lt; c`");
  });

  it.each([
    ["a code span", "`<img src=x onerror=alert(1)>`"],
    ["an unclosed code span", "`<img src=x onerror=alert(1)>"],
    ["mismatched backtick runs", "``<img src=x onerror=alert(1)>`"],
    ["a code span over a line break", "`x\n<img src=x onerror=alert(1)>\ny`"],
    ["an HTML block", "<p>`<img src=x onerror=alert(1)>`</p>"],
  ])("sanitizes markup inside %s", (_shape, markdown) => {
    const sanitized = sanitizeMarkdown(markdown);

    expect(sanitized).toContain('<img src="x" />');
    expect(sanitized).not.toContain("onerror");
  });

  it.each([
    ["a code span", "`&lt;script&gt;alert(1)&lt;/script&gt;`"],
    ["an unclosed code span", "`&lt;script&gt;alert(1)&lt;/script&gt;"],
    ["an HTML block", "<p>`&lt;script&gt;alert(1)&lt;/script&gt;`</p>"],
    ["prose", "&lt;script&gt;alert(1)&lt;/script&gt;"],
  ])("keeps an escaped tag escaped in %s", (_shape, markdown) => {
    const sanitized = sanitizeMarkdown(markdown);

    expect(sanitized).toContain("&lt;script>alert(1)&lt;/script>");
    expect(sanitized).not.toContain("<script");
  });

  it("preserves underline tags outside fenced code blocks", () => {
    const sanitized = sanitizeMarkdown("hello <u>world</u>");

    expect(sanitized).toContain("<u>world</u>");
  });

  it("preserves literal placeholder-like text outside code blocks", () => {
    const literalPlaceholder = "@@SANITIZE_CODEBLOCKTOKEN_0_0@@";
    const markdown = [
      literalPlaceholder,
      "",
      "```html",
      "<div>safe inside code</div>",
      "```",
    ].join("\n");

    const sanitized = sanitizeMarkdown(markdown);

    expect(sanitized.startsWith(`${literalPlaceholder}\n\n`)).toBe(true);
    expect(sanitized).toContain("```html\n<div>safe inside code</div>\n```");
  });

  it("preserves raw video and audio tags with media attributes", () => {
    const markdown = [
      '<video src="https://blob.example.com/clip.mp4" controls loop muted></video>',
      '<audio src="https://blob.example.com/track.mp3" controls loop muted></audio>',
    ].join("\n");

    const sanitized = sanitizeMarkdown(markdown);

    expect(sanitized).toContain("<video");
    expect(sanitized).toContain('src="https://blob.example.com/clip.mp4"');
    expect(sanitized).toContain("<audio");
    expect(sanitized).toContain('src="https://blob.example.com/track.mp3"');
    expect(sanitized).toContain("controls");
  });

  it("keeps mention Direct chip identity on spans", () => {
    const sanitized = sanitizeMarkdown(
      '<span class="text-primary font-medium whitespace-nowrap" data-direct-kind="coworker" data-direct-id="cow_1">@Elena</span>',
    );

    expect(sanitized).toContain('data-direct-kind="coworker"');
    expect(sanitized).toContain('data-direct-id="cow_1"');
    expect(sanitized).toContain("whitespace-nowrap");
    expect(sanitized).toContain("@Elena");
  });

  it("keeps markdown blockquote markers that sanitize-html would encode", () => {
    expect(sanitizeMarkdown("> quoted")).toBe("> quoted");
    expect(sanitizeMarkdown("> line one\n> line two")).toBe(
      "> line one\n> line two",
    );
  });

  it("does not rewrite &gt; inside fenced code", () => {
    const markdown = ["```", "&gt; quoted", "```"].join("\n");

    expect(sanitizeMarkdown(markdown)).toContain("&gt; quoted");
  });

  it("encodes bare URL ampersands for the Markdown parser", () => {
    expect(sanitizeMarkdown("see https://a.test/?p=1&c=1&d=2.")).toBe(
      "see https://a.test/?p=1&amp;c=1&amp;d=2.",
    );
    expect(sanitizeMarkdown("www.a.test/?p=1&c=1")).toBe(
      "www.a.test/?p=1&amp;c=1",
    );
  });

  it("leaves & outside a bare URL encoded", () => {
    expect(sanitizeMarkdown("Tom & Jerry https://a.test/?p=1&c=1 R&D")).toBe(
      "Tom &amp; Jerry https://a.test/?p=1&amp;c=1 R&amp;D",
    );
    expect(sanitizeMarkdown('<a href="https://a.test/?p=1&c=1">link</a>')).toBe(
      '<a href="https://a.test/?p=1&amp;c=1">link</a>',
    );
  });

  it("does not rewrite &amp; in a bare URL inside fenced code", () => {
    const markdown = ["```", "https://a.test/?p=1&amp;c=1", "```"].join("\n");

    expect(sanitizeMarkdown(markdown)).toContain("https://a.test/?p=1&amp;c=1");
  });

  it("strips autoplay from video and audio tags", () => {
    const markdown = [
      '<video src="https://blob.example.com/clip.mp4" controls autoplay></video>',
      '<audio src="https://blob.example.com/track.mp3" controls autoplay></audio>',
    ].join("\n");

    const sanitized = sanitizeMarkdown(markdown);

    expect(sanitized).toContain("<video");
    expect(sanitized).toContain("<audio");
    expect(sanitized.toLowerCase()).not.toContain("autoplay");
  });
});
