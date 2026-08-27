import { describe, expect, it } from "vitest";

import { segmentRoomMessageContent } from "./room-message-segments";

describe("segmentRoomMessageContent", () => {
  it("groups consecutive file links separated only by newlines", () => {
    const content =
      "[a.png](https://cdn.example/a.png)\n[b.png](https://cdn.example/b.png)\n";
    expect(segmentRoomMessageContent(content)).toEqual([
      {
        kind: "files",
        links: [
          expect.objectContaining({ fileName: "a.png" }),
          expect.objectContaining({ fileName: "b.png" }),
        ],
      },
    ]);
  });

  it("splits file groups when prose sits between attachments", () => {
    const content =
      "[a.png](https://cdn.example/a.png)\nsee also\n[b.png](https://cdn.example/b.png)";
    const kinds = segmentRoomMessageContent(content).map((s) => s.kind);
    expect(kinds).toEqual(["files", "text", "files"]);
  });

  it("returns a single text segment for text-only content", () => {
    expect(segmentRoomMessageContent("hello world")).toEqual([
      { kind: "text", content: "hello world", start: 0 },
    ]);
  });

  it("returns a single text segment for empty content", () => {
    expect(segmentRoomMessageContent("")).toEqual([
      { kind: "text", content: "", start: 0 },
    ]);
  });

  it("keeps trailing text after files", () => {
    const content = "[a.png](https://cdn.example/a.png)\nand then more prose";
    const segments = segmentRoomMessageContent(content);
    expect(segments.map((s) => s.kind)).toEqual(["files", "text"]);
    expect(segments[1]).toEqual(
      expect.objectContaining({
        kind: "text",
        content: "\nand then more prose",
      }),
    );
  });
});
