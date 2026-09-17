import { describe, expect, it } from "vitest";

import { clearComposerFormat } from "@/lib/utils/composer-clear-format";
import {
  htmlToMarkdown,
  markdownToHtml,
} from "@/lib/utils/composer-markdown-dom";

function resolveMention(mentionKey: string, mentionSlug: string) {
  return mentionKey === "user_1"
    ? { displayName: "Alice Smith", isKnown: true }
    : { displayName: mentionSlug, isKnown: false };
}

function clearFormatFromMarkdown(markdown: string): string {
  const root = document.createElement("div");
  root.innerHTML = markdownToHtml(markdown, resolveMention);
  const range = document.createRange();
  range.selectNodeContents(root);
  clearComposerFormat(root, range);
  return htmlToMarkdown(root).trim();
}

function clearFormatFromHtml(html: string): string {
  const root = document.createElement("div");
  root.innerHTML = html;
  const range = document.createRange();
  range.selectNodeContents(root);
  clearComposerFormat(root, range);
  return htmlToMarkdown(root).trim();
}

describe("clearComposerFormat", () => {
  it("unwraps bold to plain text", () => {
    expect(clearFormatFromMarkdown("**bold**")).toBe("bold");
  });

  it("unwraps italic to plain text", () => {
    expect(clearFormatFromMarkdown("_italic_")).toBe("italic");
  });

  it("unwraps inline code to plain text", () => {
    expect(clearFormatFromMarkdown("`code`")).toBe("code");
  });

  it("unwraps links to plain text", () => {
    expect(clearFormatFromMarkdown("[click](https://example.com)")).toBe(
      "click",
    );
  });

  it("unwraps headings to plain text", () => {
    expect(clearFormatFromMarkdown("## heading")).toBe("heading");
  });

  it("unwraps bullet lists to plain text", () => {
    expect(clearFormatFromMarkdown("- one\n- two")).toBe("one\ntwo");
  });

  it("unwraps fenced code blocks to plain text", () => {
    expect(clearFormatFromMarkdown("```\nline\n```")).toBe("line");
  });

  it("keeps mention chips when clearing bold around them", () => {
    const root = document.createElement("div");
    root.innerHTML = markdownToHtml(
      "hello @user_1:alice-smith",
      resolveMention,
    );
    const chip = root.querySelector("[data-mention-key='user_1']");
    expect(chip).not.toBeNull();

    const strong = document.createElement("strong");
    while (root.firstChild) {
      strong.appendChild(root.firstChild);
    }
    root.appendChild(strong);

    const range = document.createRange();
    range.selectNodeContents(root);
    clearComposerFormat(root, range);

    expect(htmlToMarkdown(root).trim()).toBe("hello @user_1:alice-smith");
    expect(root.querySelector("[data-mention-key='user_1']")).not.toBeNull();
    expect(root.querySelector("strong, b")).toBeNull();
  });

  it("leaves a chip untouched when only the chip is selected", () => {
    const html = markdownToHtml("@user_1:alice-smith", resolveMention);
    const root = document.createElement("div");
    root.innerHTML = html;
    const chip = root.querySelector("[data-mention-key='user_1']");
    expect(chip).not.toBeNull();

    const range = document.createRange();
    range.selectNodeContents(chip as HTMLElement);
    const { didChange } = clearComposerFormat(root, range);

    expect(didChange).toBe(false);
    expect(root.querySelector("[data-mention-key='user_1']")).not.toBeNull();
    expect(htmlToMarkdown(root).trim()).toBe("@user_1:alice-smith");
  });

  it("unwraps the heading when the caret is collapsed inside h2", () => {
    const root = document.createElement("div");
    root.innerHTML = markdownToHtml("## heading", resolveMention);
    const heading = root.querySelector("h2");
    expect(heading).not.toBeNull();

    const textNode = heading?.firstChild;
    expect(textNode).not.toBeNull();

    const range = document.createRange();
    range.setStart(textNode as Node, 1);
    range.collapse(true);
    clearComposerFormat(root, range);

    expect(htmlToMarkdown(root).trim()).toBe("heading");
    expect(root.querySelector("h2")).toBeNull();
  });

  it("unwraps only the inline mark when the caret is collapsed inside it", () => {
    const root = document.createElement("div");
    root.innerHTML = "plain <strong>bold</strong> and <em>italic</em>";
    const strong = root.querySelector("strong");
    expect(strong).not.toBeNull();
    const textNode = strong?.firstChild;
    expect(textNode).not.toBeNull();

    const range = document.createRange();
    range.setStart(textNode as Node, 1);
    range.collapse(true);
    clearComposerFormat(root, range);

    expect(htmlToMarkdown(root).trim()).toBe("plain bold and _italic_");
    expect(root.querySelector("strong, b")).toBeNull();
    expect(root.querySelector("em, i")).not.toBeNull();
  });

  it("preserves div and br line breaks", () => {
    expect(clearFormatFromHtml("line1<div>line2</div>line3<br>line4")).toBe(
      "line1\nline2\nline3\nline4",
    );
  });
});
