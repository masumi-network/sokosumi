import { describe, expect, it } from "vitest";
import {
  buildRoomComposerMessageContent,
  isRoomComposerEmpty,
} from "../room-helpers";

function formatLink(fileName: string, url: string): string {
  return `[${fileName}](${url})\n`;
}

describe("buildRoomComposerMessageContent", () => {
  it("returns trimmed text when there are no attachments", () => {
    expect(buildRoomComposerMessageContent("  hello  ", [], formatLink)).toBe(
      "hello",
    );
  });

  it("returns attachment markdown only when text is empty", () => {
    expect(
      buildRoomComposerMessageContent(
        "   ",
        [{ fileName: "image.jpg", url: "https://blob.example/image.jpg" }],
        formatLink,
      ),
    ).toBe("[image.jpg](https://blob.example/image.jpg)");
  });

  it("appends attachment markdown after text", () => {
    expect(
      buildRoomComposerMessageContent(
        "caption",
        [{ fileName: "image.jpg", url: "https://blob.example/image.jpg" }],
        formatLink,
      ),
    ).toBe("caption\n[image.jpg](https://blob.example/image.jpg)");
  });
});

describe("isRoomComposerEmpty", () => {
  it("is empty only when text and attachments are both empty", () => {
    expect(isRoomComposerEmpty("", [])).toBe(true);
    expect(isRoomComposerEmpty("   ", [])).toBe(true);
    expect(isRoomComposerEmpty("hi", [])).toBe(false);
    expect(
      isRoomComposerEmpty("", [
        { fileName: "a.jpg", url: "https://blob.example/a.jpg" },
      ]),
    ).toBe(false);
  });
});
