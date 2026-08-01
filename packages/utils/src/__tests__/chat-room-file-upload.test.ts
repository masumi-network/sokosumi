import { describe, expect, it } from "vitest";

import {
  buildCoworkerChatRoomFilePathname,
  buildCoworkerChatRoomFilePrefix,
  buildUserChatRoomFilePathname,
  buildUserChatRoomFilePrefix,
  CHAT_ROOM_FILE_MAX_SIZE_BYTES,
  isOwnedCoworkerChatRoomFileUrl,
  isOwnedUserChatRoomFileUrl,
} from "../chat-room-file-upload.js";

describe("chat room file upload helpers", () => {
  it("exposes the shared upload max size", () => {
    expect(CHAT_ROOM_FILE_MAX_SIZE_BYTES).toBe(100 * 1024 * 1024);
  });

  it("builds user-owned chat room prefixes and pathnames", () => {
    expect(buildUserChatRoomFilePrefix("user_123", "room_abc")).toBe(
      "users/user_123/chats/room_abc/",
    );
    expect(
      buildUserChatRoomFilePathname(
        "user_123",
        "room_abc",
        " hello world.pdf ",
      ),
    ).toBe("users/user_123/chats/room_abc/hello_world.pdf");
  });

  it("builds coworker-owned chat room prefixes and pathnames", () => {
    expect(buildCoworkerChatRoomFilePrefix("cow_123", "room_abc")).toBe(
      "coworkers/cow_123/chats/room_abc/",
    );
    expect(
      buildCoworkerChatRoomFilePathname("cow_123", "room_abc", "../notes.txt"),
    ).toBe("coworkers/cow_123/chats/room_abc/notes.txt");
  });

  it("detects owned chat room file URLs", () => {
    expect(
      isOwnedUserChatRoomFileUrl(
        "https://blob.example.com/users/user_123/chats/room_abc/file-xyz.pdf",
        "user_123",
        "room_abc",
      ),
    ).toBe(true);
    expect(
      isOwnedUserChatRoomFileUrl(
        "https://blob.example.com/users/user_123/flat.pdf",
        "user_123",
        "room_abc",
      ),
    ).toBe(false);
    expect(
      isOwnedCoworkerChatRoomFileUrl(
        "https://blob.example.com/coworkers/cow_123/chats/room_abc/a.txt",
        "cow_123",
        "room_abc",
      ),
    ).toBe(true);
    expect(
      isOwnedCoworkerChatRoomFileUrl(
        "https://blob.example.com/coworkers/cow_123/image-ops.png",
        "cow_123",
        "room_abc",
      ),
    ).toBe(false);
  });
});
