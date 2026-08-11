import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { CHAT_MESSAGE_LIST_SCROLLER_CLASS } from "../../chat-message-list-scroller";
import {
  ROOM_SHELL_MAIN_CLASSNAME,
  ROOM_SHELL_SCROLLER_CLASSNAME,
} from "../room-shell-layout";

describe("RoomsClient Ably island", () => {
  it("wraps multi-room realtime bridge in local LazyAblyProvider (no single-user ChannelProvider)", () => {
    const source = readFileSync(
      join(import.meta.dirname, "../rooms-client.tsx"),
      "utf8",
    );
    const shellSource = readFileSync(
      join(import.meta.dirname, "../room-shell-layout.tsx"),
      "utf8",
    );

    expect(source).toContain('from "@/contexts/lazy-ably-provider"');
    expect(source).toMatch(
      /LazyAblyProvider>\s*<RoomMessageRealtimeBridge[\s\S]*<\/LazyAblyProvider>/,
    );
    expect(source).not.toContain("ChannelProvider");
    expect(source).toContain("roomIds={rooms.map((room) => room.id)}");
    // Open room chrome lives in RoomShellLayout (Instant + progressive share it).
    expect(source).toContain("listScrollerRef={scrollerRef}");
    expect(source).toContain("<RoomShellLayout");
    // Assert exported shell contracts (not source-string formatting).
    expect(ROOM_SHELL_MAIN_CLASSNAME).toContain("overflow-x-clip");
    expect(ROOM_SHELL_SCROLLER_CLASSNAME).toContain("overflow-y-auto");
    expect(ROOM_SHELL_SCROLLER_CLASSNAME).toContain(
      CHAT_MESSAGE_LIST_SCROLLER_CLASS,
    );
    expect(shellSource).toMatch(
      /ref=\{listScrollerRef\}[\s\S]*?className=\{ROOM_SHELL_SCROLLER_CLASSNAME\}/,
    );
    expect(source).not.toContain("ScrollArea");
    expect(shellSource).not.toContain("ScrollArea");
  });

  it("routes realtime through scope helper and only merges room on top-level", () => {
    const source = readFileSync(
      join(import.meta.dirname, "../rooms-client.tsx"),
      "utf8",
    );

    // Regression: thread panel send must not also paint in the room list.
    // Assert control flow, not mere identifier presence (identifier-only can
    // pass while setMessagesState still always runs).
    expect(source).toContain("routeRealtimeChatRoomMessage");
    expect(source).toContain("filterTopLevelChatRoomMessages");
    expect(source).toContain("isReplyUnderThreadParent");
    expect(source).toMatch(
      /const route = routeRealtimeChatRoomMessage\(\s*message,\s*threadParentMessageIdRef\.current,\s*event\.eventType,\s*\)/,
    );
    expect(source).toMatch(
      /if \(route\.mergeIntoRoomTimeline\) \{\s*setMessagesState/,
    );
    expect(source).toMatch(
      /if \(route\.mergeIntoOpenThread\) \{\s*setThreadMessages/,
    );
    expect(source).toMatch(
      /filterTopLevelChatRoomMessages\(\s*messagesState\s*\)/,
    );
  });
});
