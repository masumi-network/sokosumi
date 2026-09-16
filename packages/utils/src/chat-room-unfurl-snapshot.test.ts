import { describe, expect, it } from "vitest";

import {
  buildChatRoomUnfurlSnapshotPathname,
  CHAT_ROOM_UNFURL_SNAPSHOT_MAX_SIZE_BYTES,
  isChatRoomUnfurlSnapshotAllowedContentType,
  isOwnedChatRoomUnfurlSnapshotUrl,
} from "./chat-room-unfurl-snapshot.js";

const ROOM_ID = "019fa92e-3818-707e-86ea-2db89f35cc23";
const MESSAGE_ID = "01a0aa15-ef43-71c5-9126-c006c8732239";

describe("chat room unfurl snapshot paths", () => {
  it("nests snapshots under the room and message", () => {
    expect(
      buildChatRoomUnfurlSnapshotPathname(ROOM_ID, MESSAGE_ID, "image/png"),
    ).toBe(`chats/${ROOM_ID}/unfurls/${MESSAGE_ID}/image-preview.png`);
    expect(
      buildChatRoomUnfurlSnapshotPathname(ROOM_ID, MESSAGE_ID, "image/jpeg"),
    ).toBe(`chats/${ROOM_ID}/unfurls/${MESSAGE_ID}/image-preview.jpg`);
  });

  it("allows 5 MB and the usual raster image types, never svg", () => {
    expect(CHAT_ROOM_UNFURL_SNAPSHOT_MAX_SIZE_BYTES).toBe(5 * 1024 * 1024);
    expect(isChatRoomUnfurlSnapshotAllowedContentType("image/png")).toBe(true);
    expect(isChatRoomUnfurlSnapshotAllowedContentType("image/webp")).toBe(true);
    expect(isChatRoomUnfurlSnapshotAllowedContentType("image/svg+xml")).toBe(
      false,
    );
    expect(isChatRoomUnfurlSnapshotAllowedContentType("text/html")).toBe(false);
  });
});

describe("isOwnedChatRoomUnfurlSnapshotUrl", () => {
  const owned = `https://abc123.public.blob.vercel-storage.com/chats/${ROOM_ID}/unfurls/${MESSAGE_ID}/image-preview-x1y2.png`;

  it("accepts a public Blob URL under the message's snapshot prefix", () => {
    expect(isOwnedChatRoomUnfurlSnapshotUrl(owned, ROOM_ID, MESSAGE_ID)).toBe(
      true,
    );
  });

  it("rejects other messages, other rooms, foreign hosts, and source images", () => {
    expect(
      isOwnedChatRoomUnfurlSnapshotUrl(owned, ROOM_ID, "other-message"),
    ).toBe(false);
    expect(
      isOwnedChatRoomUnfurlSnapshotUrl(owned, "other-room", MESSAGE_ID),
    ).toBe(false);
    expect(
      isOwnedChatRoomUnfurlSnapshotUrl(
        `https://evil.example.com/chats/${ROOM_ID}/unfurls/${MESSAGE_ID}/x.png`,
        ROOM_ID,
        MESSAGE_ID,
      ),
    ).toBe(false);
    expect(
      isOwnedChatRoomUnfurlSnapshotUrl(
        "https://jf.x.com/images/post/2100178016617869710.png",
        ROOM_ID,
        MESSAGE_ID,
      ),
    ).toBe(false);
  });
});
