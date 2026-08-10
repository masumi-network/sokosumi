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

/** Tokens that encode the room blank-line spacing contract. */
const DENSITY_CLASS = "prose-p:my-0";
const INTER_PARAGRAPH_GAP_CLASS = "[&_p+p]:mt-3";

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

/**
 * Blank-line contract: adjacent content paragraphs under density + gap classes.
 * Does not accept empty `<p>`, multi-`<br>`, or non-zeroed margins as substitutes.
 */
function assertsBlankLineSpacingContract(container: HTMLElement): void {
  const paragraphs = Array.from(container.querySelectorAll("p"));
  const rootClass = roomRootClass(container);

  expect(paragraphs.length).toBeGreaterThanOrEqual(2);
  expect(paragraphs.every((p) => (p.textContent ?? "").trim().length > 0)).toBe(
    true,
  );
  expect(rootClass).toContain(DENSITY_CLASS);
  expect(rootClass).toContain(INTER_PARAGRAPH_GAP_CLASS);
}

describe("room message blank lines after send", () => {
  it("ROOM_MESSAGE_MARKDOWN_CLASSNAME carries density + inter-paragraph gap", () => {
    expect(ROOM_MESSAGE_MARKDOWN_CLASSNAME).toContain(DENSITY_CLASS);
    expect(ROOM_MESSAGE_MARKDOWN_CLASSNAME).toContain(
      INTER_PARAGRAPH_GAP_CLASS,
    );
  });

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

  it("AFTER SEND: blank line uses adjacent paragraphs with density + gap classes", () => {
    const md = fromHtml("line one<br><br>line two");
    const payload = buildRoomComposerMessageContent(md, [], () => "");
    const { container } = renderRoom(payload);
    assertsBlankLineSpacingContract(container);
  });

  it("AFTER SEND: single-paragraph message keeps density without multi-p requirement", () => {
    const { container } = renderRoom("just one paragraph");
    const paragraphs = container.querySelectorAll("p");
    const rootClass = roomRootClass(container);

    expect(paragraphs.length).toBe(1);
    expect(rootClass).toContain(DENSITY_CLASS);
    expect(rootClass).toContain(INTER_PARAGRAPH_GAP_CLASS);
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
