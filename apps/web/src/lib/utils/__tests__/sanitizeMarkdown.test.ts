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
