import { describe, expect, it } from "vitest";
import {
  markdownHastSchema,
  sanitizeMarkdown,
} from "@/lib/utils/sanitizeMarkdown";

describe("markdownHastSchema", () => {
  it("admits no tag that runs or embeds content", () => {
    expect(markdownHastSchema.tagNames).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^(script|iframe|style|object|embed|form|link|meta|base|svg|math)$/,
        ),
      ]),
    );
  });

  it("admits no event handler, style or unscoped class attribute", () => {
    const names = Object.values(markdownHastSchema.attributes ?? {})
      .flat()
      .filter((definition) => typeof definition === "string");

    expect(names).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^(on.*|style|className|srcDoc|name)$/),
      ]),
    );
  });
});

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

  // Markdown opens no fence on a line whose info string carries a backtick,
  // so what follows is markup and must not be lifted out as code.
  it("sanitizes under an opener whose info string carries a backtick", () => {
    const sanitized = sanitizeMarkdown(
      ["``` `x", "<script>x</script><b>kept</b>", "```"].join("\n"),
    );

    expect(sanitized).not.toContain("<script>");
    expect(sanitized).toContain("<b>kept</b>");
  });

  // Fences markdown reads and the line rule does not. Their content goes
  // through the sanitizer: mangled as code, and safe.
  it.each([
    ["unclosed", "```\n<script>x</script>"],
    ["indented", "  ```\n<script>x</script>\n  ```"],
    ["in a list", "- item\n  ```\n  <script>x</script>\n  ```"],
    ["in a blockquote", "> ```\n> <script>x</script>\n> ```"],
    ["written in tildes", "~~~\n<script>x</script>\n~~~"],
    ["closed by a longer run", "```\n<script>x</script>\n``````"],
  ])("sanitizes a fence that is %s", (_name, markdown) => {
    expect(sanitizeMarkdown(markdown)).not.toContain("<script>");
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
