import { describe, expect, it } from "vitest";
import {
  buildChatSummaryPrompt,
  chatSummaryCacheCovers,
  parseChatSummaryText,
} from "./chat-catch-up-summary.service";

describe("chatSummaryCacheCovers", () => {
  it("reuses the text until a message arrives it has not read", () => {
    expect(chatSummaryCacheCovers(["a", "b"], ["a", "b"])).toBe(true);
    // Reading shrinks what is unread; the cached text still covers it.
    expect(chatSummaryCacheCovers(["a", "b"], ["b"])).toBe(true);
    expect(chatSummaryCacheCovers(["a", "b"], ["b", "c"])).toBe(false);
  });
});

describe("parseChatSummaryText", () => {
  const rooms = new Map([["r0", "room-1"]]);

  it("reads the JSON, even with text around it, and maps room keys", () => {
    expect(
      parseChatSummaryText(
        'Here: {"headline": "Bob needs the pricing sheet.", "rooms": [{"room": "r0", "line": "Launch moved to Monday."}, {"room": "r9", "line": "x"}]}',
        rooms,
      ),
    ).toEqual({
      headline: "Bob needs the pricing sheet.",
      rooms: [{ roomId: "room-1", line: "Launch moved to Monday." }],
    });
  });

  it("is null for anything that is not the expected JSON", () => {
    expect(parseChatSummaryText("no json here", rooms)).toBeNull();
    expect(parseChatSummaryText('{"headline": 3}', rooms)).toBeNull();
  });
});

describe("buildChatSummaryPrompt", () => {
  it("labels what needs the reader and decisions, and cuts long text", () => {
    const prompt = JSON.parse(
      buildChatSummaryPrompt([
        {
          key: "r0",
          name: "launch",
          messages: [
            { bucket: "needsYou", author: "Bob", text: "Can you decide?" },
            { bucket: "decisionMade", author: "Dan", text: "We go with B" },
            { bucket: "fyi", author: "Carla", text: "x".repeat(400) },
          ],
        },
      ]),
    );
    expect(
      prompt.rooms[0].messages.map((m: { label: string }) => m.label),
    ).toEqual(["NEEDS_YOU", "DECISION", "fyi"]);
    expect(prompt.rooms[0].messages[2].text.length).toBe(301);
  });
});
