import { CHAT_MESSAGE_PREVIEW_MAX_LENGTH } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";
import { formatUnreadThreadsPreview } from "@/app/chat/utils/unread-threads-preview";

describe("formatUnreadThreadsPreview", () => {
  it("strips markdown tokens and collapses whitespace", () => {
    expect(
      formatUnreadThreadsPreview(
        "Hello **bold** and `b49207ef…`\n\nsecond line",
      ),
    ).toBe("Hello bold and b49207ef… second line");
  });

  it("collapses @id:slug mention tokens to @slug", () => {
    expect(
      formatUnreadThreadsPreview(
        "@019fc7e4-e4bd-7005-900c-66e44d33f5e4:noodles Hello Noodles",
      ),
    ).toBe("@noodles Hello Noodles");
  });

  it("names a mentioned member when the room's roster is given", () => {
    expect(
      formatUnreadThreadsPreview(
        "@019fc7e4-e4bd-7005-900c-66e44d33f5e4:noodles Hello",
        new Map([["019fc7e4-e4bd-7005-900c-66e44d33f5e4", "Noodle Chef"]]),
      ),
    ).toBe("@Noodle Chef Hello");
  });

  it("renders @all:all as @all when the room roster is not given", () => {
    expect(formatUnreadThreadsPreview("ping @all:all please")).toBe(
      "ping @all please",
    );
  });

  it("names the room-wide mention when the room's roster is given", () => {
    expect(
      formatUnreadThreadsPreview(
        "ping @all:all please",
        new Map([["all", "Everyone"]]),
      ),
    ).toBe("ping @Everyone please");
  });

  it("returns empty string when content is only markup", () => {
    expect(formatUnreadThreadsPreview("****")).toBe("");
  });

  /**
   * A thread row is one line beside a room name. The shared rule already cuts
   * to a length that fits, and this row must take the cut rather than let a
   * long message push the room name off the screen.
   */
  it("cuts a long message to the length the shared rule allows", () => {
    const preview = formatUnreadThreadsPreview("a".repeat(400));

    expect([...preview]).toHaveLength(CHAT_MESSAGE_PREVIEW_MAX_LENGTH);
    expect(preview.endsWith("…")).toBe(true);
  });
});
