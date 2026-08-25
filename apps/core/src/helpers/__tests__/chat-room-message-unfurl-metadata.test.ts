import { describe, expect, it } from "vitest";

import { mergeUnfurlsIntoMessageMetadata } from "../chat-room-message-unfurl-metadata";

describe("mergeUnfurlsIntoMessageMetadata", () => {
  const card = {
    url: "https://example.com",
    title: "Example",
    description: "Desc",
    imageUrl: "https://cdn.example/i.png",
    siteName: "Ex",
  };

  it("sets unfurls without wiping quote or membership", () => {
    expect(
      mergeUnfurlsIntoMessageMetadata(
        {
          quote: { messageId: "q1", authorName: "A", snippet: "s" },
          membership: {
            action: "joined",
            subject: { type: "user", id: "u1", name: "U" },
          },
        },
        [card],
      ),
    ).toEqual({
      quote: { messageId: "q1", authorName: "A", snippet: "s" },
      membership: {
        action: "joined",
        subject: { type: "user", id: "u1", name: "U" },
      },
      unfurls: [card],
    });
  });

  it("removes unfurls key on empty scrape while preserving quote", () => {
    expect(
      mergeUnfurlsIntoMessageMetadata(
        {
          quote: { messageId: "q1", authorName: "A", snippet: "s" },
          unfurls: [card],
        },
        [],
      ),
    ).toEqual({
      quote: { messageId: "q1", authorName: "A", snippet: "s" },
    });
  });

  it("returns null when clearing the only key", () => {
    expect(mergeUnfurlsIntoMessageMetadata({ unfurls: [card] }, [])).toBeNull();
  });
});
