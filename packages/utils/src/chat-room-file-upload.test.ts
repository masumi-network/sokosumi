import { describe, expect, it } from "vitest";

import {
  buildCoworkerChatRoomFilePathname,
  buildCoworkerChatRoomFilePrefix,
  buildSokoBotChatRoomFilePathname,
  buildSokoBotChatRoomFilePrefix,
  buildUserChatRoomFilePathname,
  buildUserChatRoomFilePrefix,
  CHAT_ROOM_FILE_MAX_SIZE_BYTES,
  chatRoomFileLinks,
  isOwnedCoworkerChatRoomFileUrl,
  isOwnedSokoBotChatRoomFileUrl,
  isOwnedUserChatRoomFileUrl,
  parseChatRoomFileUrl,
} from "./chat-room-file-upload.js";

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

  it("builds soko-bot-owned chat room prefixes and pathnames", () => {
    expect(buildSokoBotChatRoomFilePrefix("bot_123", "room_abc")).toBe(
      "soko-bots/bot_123/chats/room_abc/",
    );
    expect(
      buildSokoBotChatRoomFilePathname("bot_123", "room_abc", "../notes.txt"),
    ).toBe("soko-bots/bot_123/chats/room_abc/notes.txt");
  });

  it("detects owned chat room file URLs", () => {
    expect(
      isOwnedUserChatRoomFileUrl(
        "https://abc.public.blob.vercel-storage.com/users/user_123/chats/room_abc/file-xyz.pdf",
        "user_123",
        "room_abc",
      ),
    ).toBe(true);
    expect(
      isOwnedUserChatRoomFileUrl(
        "https://abc.public.blob.vercel-storage.com/users/user_123/flat.pdf",
        "user_123",
        "room_abc",
      ),
    ).toBe(false);
    expect(
      isOwnedCoworkerChatRoomFileUrl(
        "https://abc.public.blob.vercel-storage.com/coworkers/cow_123/chats/room_abc/a.txt",
        "cow_123",
        "room_abc",
      ),
    ).toBe(true);
    expect(
      isOwnedCoworkerChatRoomFileUrl(
        "https://abc.public.blob.vercel-storage.com/coworkers/cow_123/image-ops.png",
        "cow_123",
        "room_abc",
      ),
    ).toBe(false);
    expect(
      isOwnedSokoBotChatRoomFileUrl(
        "https://abc.public.blob.vercel-storage.com/soko-bots/bot_123/chats/room_abc/a.txt",
        "bot_123",
        "room_abc",
      ),
    ).toBe(true);
    expect(
      isOwnedSokoBotChatRoomFileUrl(
        "https://abc.public.blob.vercel-storage.com/soko-bots/bot_123/notes.txt",
        "bot_123",
        "room_abc",
      ),
    ).toBe(false);
  });

  it("rejects foreign hosts and non-https URLs even when the path prefix matches", () => {
    expect(
      isOwnedUserChatRoomFileUrl(
        "https://blob.example.com/users/user_123/chats/room_abc/file-xyz.pdf",
        "user_123",
        "room_abc",
      ),
    ).toBe(false);
    expect(
      isOwnedUserChatRoomFileUrl(
        "http://abc.public.blob.vercel-storage.com/users/user_123/chats/room_abc/file-xyz.pdf",
        "user_123",
        "room_abc",
      ),
    ).toBe(false);
  });
});

describe("chat attachment links", () => {
  const roomId = "01a0f500-0000-7000-8000-000000000001";
  const url = `https://abc.public.blob.vercel-storage.com/users/u-1/chats/${roomId}/1-sign-in-x7Yq.png`;

  it("reads the room from a chat attachment URL", () => {
    expect(parseChatRoomFileUrl(url)).toEqual({
      roomId,
      fileName: "1-sign-in-x7Yq.png",
    });
    expect(
      parseChatRoomFileUrl(
        `https://abc.public.blob.vercel-storage.com/soko-bots/b-1/chats/${roomId}/a.pdf`,
      ),
    ).toMatchObject({ roomId });
  });

  it("ignores other hosts, Drive files and plain http", () => {
    expect(
      parseChatRoomFileUrl(
        `https://evil.example/users/u-1/chats/${roomId}/a.png`,
      ),
    ).toBeNull();
    expect(
      parseChatRoomFileUrl(
        "https://abc.public.blob.vercel-storage.com/drive/users/u-1/a.png",
      ),
    ).toBeNull();
    expect(parseChatRoomFileUrl(url.replace("https:", "http:"))).toBeNull();
    expect(parseChatRoomFileUrl("not a url")).toBeNull();
  });

  it("lists attachments linked in a message once each, with their names", () => {
    const content = `Post these\n![1-sign-in.png](${url})[2-chat.png](${url.replace("1-sign-in", "2-chat")})\n[again](${url}) [site](https://sokosumi.com)`;
    expect(chatRoomFileLinks(content)).toEqual([
      { name: "1-sign-in.png", url },
      { name: "2-chat.png", url: url.replace("1-sign-in", "2-chat") },
    ]);
  });
});
