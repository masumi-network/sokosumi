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

  it("skips messages whose http text is not a web link, and file links", () => {
    expect(
      roomLinks([
        message("m1", "the word http alone"),
        message("m2", "https://example.com/report.pdf"),
      ]),
    ).toEqual([]);
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
