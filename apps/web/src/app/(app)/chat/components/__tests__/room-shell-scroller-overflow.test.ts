import { describe, expect, it } from "vitest";

import { CHAT_MESSAGE_LIST_SCROLLER_CLASS } from "../../chat-message-list-scroller";
import { ROOM_MESSAGE_LIST_CONTENT_CLASSNAME } from "../room-message-list-skeleton";
import { ROOM_SHELL_SCROLLER_CLASSNAME } from "../room-shell-layout";

/**
 * Regression: SOK-778 progressive shell put `flex flex-col` on the message
 * scroller while content used `min-h-full` + pixel minHeight for justify-end.
 * That combination clamps scrollHeight to clientHeight — tall rooms cannot
 * scroll up to older messages.
 *
 * Scroller must stay a non-flex overflow box; content owns min-height.
 */
describe("room shell scroller overflow contract", () => {
  it("keeps native overflow scroller without flex column", () => {
    expect(ROOM_SHELL_SCROLLER_CLASSNAME).toBe(
      CHAT_MESSAGE_LIST_SCROLLER_CLASS,
    );
    expect(ROOM_SHELL_SCROLLER_CLASSNAME).toContain("overflow-y-auto");
    expect(ROOM_SHELL_SCROLLER_CLASSNAME).toContain("min-h-0");
    expect(ROOM_SHELL_SCROLLER_CLASSNAME).toContain("flex-1");
    // flex-1 is width/height grow; display:flex on the scroller itself is the bug.
    expect(ROOM_SHELL_SCROLLER_CLASSNAME.split(/\s+/)).not.toContain("flex");
    expect(ROOM_SHELL_SCROLLER_CLASSNAME).not.toContain("flex-col");
  });

  it("content still uses min-h-full for short-transcript justify-end", () => {
    expect(ROOM_MESSAGE_LIST_CONTENT_CLASSNAME).toContain("min-h-full");
    expect(ROOM_MESSAGE_LIST_CONTENT_CLASSNAME).toContain("justify-end");
    expect(ROOM_MESSAGE_LIST_CONTENT_CLASSNAME).toContain("flex-col");
  });
});
