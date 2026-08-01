import { describe, expect, it } from "vitest";

import {
  applyComposerFormat,
  applyMarkdownLink,
  buildMarkdownLink,
  wrapCodeBlock,
  wrapInline,
  wrapLines,
} from "@/lib/utils/composer-markdown-wrap";

describe("wrapInline", () => {
  it("wraps a selection with bold markers", () => {
    expect(wrapInline("hello world", 0, 5, "**")).toEqual({
      text: "**hello** world",
      selectionStart: 2,
      selectionEnd: 7,
    });
  });

  it("inserts markers with caret between when selection is empty", () => {
    expect(wrapInline("hello", 5, 5, "**")).toEqual({
      text: "hello****",
      selectionStart: 7,
      selectionEnd: 7,
    });
  });

  it("unwraps when selection already includes markers", () => {
    expect(wrapInline("**hello**", 0, 9, "**")).toEqual({
      text: "hello",
      selectionStart: 0,
      selectionEnd: 5,
    });
  });

  it("unwraps when markers surround the selection", () => {
    expect(wrapInline("**hello**", 2, 7, "**")).toEqual({
      text: "hello",
      selectionStart: 0,
      selectionEnd: 5,
    });
  });

  it("wraps underline with HTML tags", () => {
    expect(wrapInline("hi", 0, 2, "<u>", "</u>")).toEqual({
      text: "<u>hi</u>",
      selectionStart: 3,
      selectionEnd: 5,
    });
  });
});

describe("wrapLines", () => {
  it("prefixes each selected line", () => {
    expect(wrapLines("a\nb", 0, 3, "> ")).toEqual({
      text: "> a\n> b",
      selectionStart: 0,
      selectionEnd: 7,
    });
  });

  it("removes prefix when every line already has it", () => {
    expect(wrapLines("> a\n> b", 0, 7, "> ")).toEqual({
      text: "a\nb",
      selectionStart: 0,
      selectionEnd: 3,
    });
  });

  it("expands to whole lines from a mid-line caret", () => {
    expect(wrapLines("hello", 2, 2, "- ")).toEqual({
      text: "- hello",
      selectionStart: 0,
      selectionEnd: 7,
    });
  });
});

describe("wrapCodeBlock", () => {
  it("wraps selection in a fenced code block", () => {
    expect(wrapCodeBlock("code", 0, 4)).toEqual({
      text: "```\ncode\n```",
      selectionStart: 4,
      selectionEnd: 8,
    });
  });

  it("places caret inside an empty fence", () => {
    expect(wrapCodeBlock("", 0, 0)).toEqual({
      text: "```\n\n```",
      selectionStart: 4,
      selectionEnd: 4,
    });
  });
});

describe("buildMarkdownLink / applyMarkdownLink", () => {
  it("builds a markdown link for a valid https URL", () => {
    expect(buildMarkdownLink("docs", "https://example.com")).toBe(
      "[docs](https://example.com/)",
    );
  });

  it("returns null for an invalid URL", () => {
    expect(buildMarkdownLink("docs", "not-a-url")).toBeNull();
  });

  it("replaces the selection with a markdown link", () => {
    expect(
      applyMarkdownLink("see here please", 4, 8, "here", "https://x.test"),
    ).toEqual({
      text: "see [here](https://x.test/) please",
      selectionStart: 4,
      selectionEnd: 27,
    });
  });
});

describe("applyComposerFormat", () => {
  it("maps bold / italic / strike / underline commands", () => {
    expect(applyComposerFormat("x", 0, 1, "bold").text).toBe("**x**");
    expect(applyComposerFormat("x", 0, 1, "italic").text).toBe("_x_");
    expect(applyComposerFormat("x", 0, 1, "strikethrough").text).toBe("~~x~~");
    expect(applyComposerFormat("x", 0, 1, "underline").text).toBe("<u>x</u>");
  });

  it("maps list and quote commands", () => {
    expect(applyComposerFormat("item", 0, 4, "bulletList").text).toBe("- item");
    expect(applyComposerFormat("item", 0, 4, "numberedList").text).toBe(
      "1. item",
    );
    expect(applyComposerFormat("note", 0, 4, "quote").text).toBe("> note");
  });
});
