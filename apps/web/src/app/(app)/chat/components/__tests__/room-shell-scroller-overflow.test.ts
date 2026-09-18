import { describe, expect, it } from "vitest";

import { CHAT_MESSAGE_LIST_SCROLLER_CLASS } from "../../chat-message-list-scroller";
import { ROOM_MESSAGE_LIST_CONTENT_CLASSNAME } from "../room-message-list-skeleton";
import { ROOM_SHELL_SCROLLER_CLASSNAME } from "../room-shell-layout";

/**
 * Regression: SOK-778 progressive shell put `flex flex-col` on the message
 * scroller while content used `min-h-full` + pixel minHeight for justify-end.
 * A flex column shrinks that child to the scroller's height, which clamps
 * scrollHeight to clientHeight — tall rooms cannot scroll up to older
 * messages.
 *
 * The scroller is a reversed flex column on purpose (bottom-anchored, see
 * `chat-message-list-scroller.ts`), so the content must refuse to shrink.
 */
describe("room shell scroller overflow contract", () => {
  it("anchors the scroller to the bottom", () => {
    expect(ROOM_SHELL_SCROLLER_CLASSNAME).toBe(
      CHAT_MESSAGE_LIST_SCROLLER_CLASS,
    );
    const classes = ROOM_SHELL_SCROLLER_CLASSNAME.split(/\s+/);
    expect(classes).toContain("overflow-y-auto");
    expect(classes).toContain("min-h-0");
    expect(classes).toContain("flex-1");
    expect(classes).toContain("flex");
    expect(classes).toContain("flex-col-reverse");
  });

  it("content refuses to shrink to the scroller's height", () => {
    expect(ROOM_MESSAGE_LIST_CONTENT_CLASSNAME.split(/\s+/)).toContain(
      "shrink-0",
    );
  });

  it("content still uses min-h-full for short-transcript justify-end", () => {
    expect(ROOM_MESSAGE_LIST_CONTENT_CLASSNAME).toContain("min-h-full");
    expect(ROOM_MESSAGE_LIST_CONTENT_CLASSNAME).toContain("justify-end");
    expect(ROOM_MESSAGE_LIST_CONTENT_CLASSNAME).toContain("flex-col");
  });
});
