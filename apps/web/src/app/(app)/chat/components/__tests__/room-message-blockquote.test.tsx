/**
 * Regression: a composer quote must still look like a quote after send.
 *
 * Composer styles `<blockquote>` as a left bar + muted text. Room markdown
 * uses `prose`, whose default literary quotes (italic + curly marks) hide
 * that chrome.
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Markdown from "@/components/markdown";
import { htmlToMarkdown } from "@/lib/utils/composer-markdown-dom";

import {
  buildRoomComposerMessageContent,
  ROOM_MESSAGE_MARKDOWN_CLASSNAME,
} from "../room-helpers";

/** Tokens that encode the composer quote chrome contract. */
const QUOTE_BAR_CLASS = "border-l-2";
const QUOTE_BAR_COLOR_CLASS = "border-input";
const QUOTE_PAD_CLASS = "pl-3";
const QUOTE_MUTED_CLASS = "text-muted-foreground";
const QUOTE_NOT_ITALIC_CLASS = "not-italic";
const QUOTE_NO_CURLY_MARKS_CLASS = "[&_p]:before:content-none";
const QUOTE_NO_CURLY_MARKS_AFTER_CLASS = "[&_p]:after:content-none";

function fromHtml(html: string): string {
  const root = document.createElement("div");
  root.innerHTML = html;
  return htmlToMarkdown(root);
}

function renderRoom(content: string) {
  return render(
    <Markdown className={ROOM_MESSAGE_MARKDOWN_CLASSNAME}>{content}</Markdown>,
  );
}

function roomRootClass(container: HTMLElement): string {
  return (container.firstElementChild as HTMLElement | null)?.className ?? "";
}

describe("room message blockquotes after send", () => {
  it("send path keeps > prefix in payload", () => {
    const md = fromHtml("<blockquote>quoted</blockquote>");
    const payload = buildRoomComposerMessageContent(md, [], () => "");
    expect(payload).toBe("> quoted");
  });

  it("AFTER SEND: quote is a blockquote with composer left-bar chrome", () => {
    const md = fromHtml("<blockquote>quoted</blockquote>");
    const payload = buildRoomComposerMessageContent(md, [], () => "");
    const { container } = renderRoom(payload);
    const quote = container.querySelector("blockquote");
    const rootClass = roomRootClass(container);

    expect(quote).not.toBeNull();
    expect(quote).toHaveTextContent("quoted");
    expect(quote).toHaveClass(QUOTE_BAR_CLASS);
    expect(quote).toHaveClass(QUOTE_BAR_COLOR_CLASS);
    expect(quote).toHaveClass(QUOTE_PAD_CLASS);
    expect(quote).toHaveClass(QUOTE_MUTED_CLASS);
    expect(quote).toHaveClass(QUOTE_NOT_ITALIC_CLASS);
    expect(quote?.className).toContain(QUOTE_NO_CURLY_MARKS_CLASS);
    expect(quote?.className).toContain(QUOTE_NO_CURLY_MARKS_AFTER_CLASS);
    expect(rootClass).toContain("prose");
  });
});
