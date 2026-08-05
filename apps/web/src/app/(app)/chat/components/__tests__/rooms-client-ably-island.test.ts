import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("RoomsClient Ably island", () => {
  it("wraps rooms ChannelProvider + bridge in local LazyAblyProvider", () => {
    const source = readFileSync(
      join(import.meta.dirname, "../rooms-client.tsx"),
      "utf8",
    );

    expect(source).toContain('from "@/contexts/lazy-ably-provider"');
    expect(source).toMatch(
      /LazyAblyProvider>\s*<ChannelProvider[\s\S]*RoomMessageRealtimeBridge[\s\S]*<\/ChannelProvider>\s*<\/LazyAblyProvider>/,
    );
    expect(source).toContain('<main className="relative flex min-h-0 flex-1">');
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
      /const route = routeRealtimeChatRoomMessage\(\s*message,\s*threadParentMessageIdRef\.current,\s*\)/,
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
