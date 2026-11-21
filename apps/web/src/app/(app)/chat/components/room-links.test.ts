import type { ChatRoomMessage } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import { linkLabel, roomLinks } from "./room-links";

function message(id: string, content: string): ChatRoomMessage {
  return { id, content } as ChatRoomMessage;
}

describe("roomLinks", () => {
  it("lists each web link once per message, in message order", () => {
    const first = message(
      "m1",
      "See https://example.com/plan and [the brief](https://docs.example.org/brief) and https://example.com/plan again",
    );
    const second = message("m2", "Older: <https://old.example.net>");

    expect(roomLinks([first, second])).toEqual([
      { url: "https://example.com/plan", message: first },
      { url: "https://docs.example.org/brief", message: first },
      { url: "https://old.example.net", message: second },
    ]);
  });

  it("lists every link in a message, with no cap", () => {
    const many = message(
      "m1",
      "https://a.example https://b.example https://c.example https://d.example",
    );

    expect(roomLinks([many]).map((link) => link.url)).toEqual([
      "https://a.example",
      "https://b.example",
      "https://c.example",
      "https://d.example",
    ]);
  });

  it("keeps links to documents but skips the room's own attachments", () => {
    const pdf = message("m2", "Brief: https://vendor.example/brief.pdf");

    expect(
      roomLinks([
        message("m1", "the word http alone"),
        pdf,
        message(
          "m3",
          "[a.png](https://abc.public.blob.vercel-storage.com/users/u-1/chats/550e8400-e29b-41d4-a716-446655440000/a.png)",
        ),
      ]),
    ).toEqual([{ url: "https://vendor.example/brief.pdf", message: pdf }]);
  });
});

describe("linkLabel", () => {
  it("shows host and path without scheme, www or a bare slash", () => {
    expect(linkLabel("https://www.example.com/")).toEqual({
      host: "example.com",
      path: "",
    });
    expect(linkLabel("http://example.com/a/b?x=1#top")).toEqual({
      host: "example.com",
      path: "/a/b?x=1#top",
    });
  });
});
