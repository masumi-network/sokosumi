/**
 * Regression: extra blank line in a typed message must still show after send.
 *
 * Composer stores blank lines as `\n\n` → two adjacent `<p>` nodes. Room styles
 * zero paragraph margins for density; without an inter-paragraph gap that blank
 * line looks swallowed after send.
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Markdown from "@/components/markdown";
import { htmlToMarkdown } from "@/lib/utils/composer-markdown-dom";

import {
  buildRoomComposerMessageContent,
  ROOM_MESSAGE_MARKDOWN_CLASSNAME,
} from "../room-helpers";

function fromHtml(html: string): string {
  const root = document.createElement("div");
  root.innerHTML = html;
  return htmlToMarkdown(root);
}

/** True if DOM still shows a blank line between "line one" and "line two". */
function hasVisibleBlankBetween(container: HTMLElement): boolean {
  const paragraphs = Array.from(container.querySelectorAll("p"));
  const brCount = container.querySelectorAll("br").length;
  const hasEmptyP = paragraphs.some((p) => (p.textContent ?? "").trim() === "");
  const rootClass =
    (container.firstElementChild as HTMLElement | null)?.className ?? "";
  const marginsZeroed = rootClass.includes("prose-p:my-0");
  // Explicit gap between consecutive paragraphs (room density fix).
  const hasInterParagraphGap = rootClass.includes("p+p]:mt-");

  if (hasEmptyP) return true;
  if (brCount >= 2) return true;
  if (hasInterParagraphGap && paragraphs.length >= 2) return true;
  if (!marginsZeroed && paragraphs.length >= 2) return true;
  return false;
}

function renderRoom(content: string) {
  return render(
    <Markdown className={ROOM_MESSAGE_MARKDOWN_CLASSNAME}>{content}</Markdown>,
  );
}

describe("room message blank lines after send", () => {
  it("send path keeps internal blank line in payload", () => {
    const md = fromHtml("line one<br><br>line two");
    const payload = buildRoomComposerMessageContent(md, [], () => "");
    expect(payload).toMatch(/line one\n\n+line two/);
  });

  it("send path keeps single soft newline in payload", () => {
    const md = fromHtml("line one<br>line two");
    const payload = buildRoomComposerMessageContent(md, [], () => "");
    expect(payload).toMatch(/line one\nline two/);
  });

  it("contenteditable blank div survives to payload", () => {
    const md = fromHtml(
      "<div>line one</div><div><br></div><div>line two</div>",
    );
    const payload = buildRoomComposerMessageContent(md, [], () => "");
    expect(payload).toMatch(/line one\n\n+line two/);
  });

  it("AFTER SEND: blank line still visible in room message body", () => {
    const md = fromHtml("line one<br><br>line two");
    const payload = buildRoomComposerMessageContent(md, [], () => "");
    const { container } = renderRoom(payload);
    expect(hasVisibleBlankBetween(container)).toBe(true);
    expect(ROOM_MESSAGE_MARKDOWN_CLASSNAME).toContain("p+p]:mt-");
  });

  it("AFTER SEND: soft single newline still visible (line break kept)", () => {
    const md = fromHtml("line one<br>line two");
    const payload = buildRoomComposerMessageContent(md, [], () => "");
    const { container } = renderRoom(payload);
    expect(container.querySelectorAll("br").length).toBeGreaterThan(0);
    expect(container.textContent).toContain("line one");
    expect(container.textContent).toContain("line two");
  });
});
