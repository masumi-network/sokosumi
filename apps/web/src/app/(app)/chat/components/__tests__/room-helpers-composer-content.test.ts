import {
  CHAT_ROOM_MESSAGE_CONTENT_MAX_LENGTH,
  CHAT_ROOM_MESSAGE_CONTENT_TOO_LONG_MESSAGE,
} from "@sokosumi/utils";
import { describe, expect, it } from "vitest";
import {
  buildRoomComposerMessageContent,
  createRoomComposerOverflowMarkdownFile,
  formatRoomComposerTooLongFailure,
  isRoomComposerContentCountVisible,
  isRoomComposerContentOverLimit,
  isRoomComposerEmpty,
  ROOM_COMPOSER_OVERFLOW_MARKDOWN_FILENAME,
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

describe("isRoomComposerContentOverLimit", () => {
  it("allows content at the 10_000 max", () => {
    expect(
      isRoomComposerContentOverLimit(
        "a".repeat(CHAT_ROOM_MESSAGE_CONTENT_MAX_LENGTH),
      ),
    ).toBe(false);
  });

  it("flags content over the 10_000 max", () => {
    expect(
      isRoomComposerContentOverLimit(
        "a".repeat(CHAT_ROOM_MESSAGE_CONTENT_MAX_LENGTH + 1),
      ),
    ).toBe(true);
  });
});

describe("isRoomComposerContentCountVisible", () => {
  it("hides the count below 9_500 characters", () => {
    expect(isRoomComposerContentCountVisible("a".repeat(9_499))).toBe(false);
  });

  it("shows the count from 9_500 through over-limit", () => {
    expect(isRoomComposerContentCountVisible("a".repeat(9_500))).toBe(true);
    expect(
      isRoomComposerContentCountVisible(
        "a".repeat(CHAT_ROOM_MESSAGE_CONTENT_MAX_LENGTH + 1),
      ),
    ).toBe(true);
  });
});

describe("formatRoomComposerTooLongFailure", () => {
  const t = (key: string, values?: { count: number; max: number }) =>
    values ? `${key} ${values.count}/${values.max}` : key;

  it("maps the Core too-long reason onto the composer copy", () => {
    expect(
      formatRoomComposerTooLongFailure(
        CHAT_ROOM_MESSAGE_CONTENT_TOO_LONG_MESSAGE,
        10_001,
        t,
      ),
    ).toBe("composerTooLong 10001/10000");
  });

  it("keeps other failure reasons and falls back to Outbound.failed", () => {
    expect(formatRoomComposerTooLongFailure("network down", 12, t)).toBe(
      "network down",
    );
    expect(formatRoomComposerTooLongFailure(null, 12, t)).toBe(
      "Outbound.failed",
    );
  });
});

describe("createRoomComposerOverflowMarkdownFile", () => {
  it("builds a markdown File from the over-limit draft", () => {
    const content = "a".repeat(CHAT_ROOM_MESSAGE_CONTENT_MAX_LENGTH + 1);
    const file = createRoomComposerOverflowMarkdownFile(content);
    expect(file.name).toBe(ROOM_COMPOSER_OVERFLOW_MARKDOWN_FILENAME);
    expect(file.type).toBe("text/markdown");
    expect(file.size).toBeGreaterThan(CHAT_ROOM_MESSAGE_CONTENT_MAX_LENGTH);
  });
});
