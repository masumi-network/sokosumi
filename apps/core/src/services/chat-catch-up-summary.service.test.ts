import { describe, expect, it } from "vitest";
import {
  buildChatCatchUpTopics,
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
  const messages = new Map([
    ["m0", "message-1"],
    ["m1", "message-2"],
  ]);

  it("reads the JSON, even with text around it, and maps message keys", () => {
    expect(
      parseChatSummaryText(
        `Here: ${JSON.stringify({
          headline: "Bob needs the pricing sheet.",
          topics: [
            {
              title: "Pricing sheet",
              summary: "Bob wants it before the call.",
              status: "waitingOnYou",
              messages: ["m0", "m9"],
            },
            // m0 is taken; a topic left with nothing is dropped.
            { title: "Again", summary: "x", status: "fyi", messages: ["m0"] },
            {
              title: "Launch",
              summary: "Moved to Monday.",
              status: "whatever",
              messages: ["m1"],
            },
          ],
        })}`,
        messages,
      ),
    ).toEqual({
      headline: "Bob needs the pricing sheet.",
      topics: [
        {
          title: "Pricing sheet",
          summary: "Bob wants it before the call.",
          status: "waitingOnYou",
          messageIds: ["message-1"],
        },
        {
          title: "Launch",
          summary: "Moved to Monday.",
          status: "fyi",
          messageIds: ["message-2"],
        },
      ],
    });
  });

  it("is null for anything that is not the expected JSON", () => {
    expect(parseChatSummaryText("no json here", messages)).toBeNull();
    expect(parseChatSummaryText('{"headline": 3}', messages)).toBeNull();
  });
});

describe("buildChatSummaryPrompt", () => {
  it("keys and labels each message, and cuts long text", () => {
    const prompt = JSON.parse(
      buildChatSummaryPrompt([
        {
          name: "launch",
          messages: [
            {
              key: "m0",
              bucket: "needsYou",
              author: "Bob",
              text: "Can you decide?",
            },
            {
              key: "m1",
              bucket: "decisionMade",
              author: "Dan",
              text: "We go with B",
            },
            {
              key: "m2",
              bucket: "fyi",
              author: "Carla",
              text: "x".repeat(400),
            },
          ],
        },
      ]),
    );
    expect(
      prompt.rooms[0].messages.map(
        (m: { key: string; label: string }) => `${m.key}:${m.label}`,
      ),
    ).toEqual(["m0:NEEDS_YOU", "m1:DECISION", "m2:fyi"]);
    expect(prompt.rooms[0].messages[2].text.length).toBe(301);
  });
});

describe("buildChatCatchUpTopics", () => {
  const room = {
    id: "room-1",
    name: "launch",
    groupName: null,
    kind: "channel",
  };
  const entry = (
    id: string,
    bucket: "needsYou" | "decisionMade" | "fyi" | "announcement",
    name: string,
    minute: number,
  ) => ({
    bucket,
    room,
    message: {
      id,
      roomId: room.id,
      parentMessageId: null,
      senderUserId: name,
      content: `${name} says ${id}`,
      createdAt: new Date(Date.UTC(2026, 9, 30, 9, minute)),
      senderUser: { name, image: `https://img/${name}` },
      senderCoworker: null,
      senderSokoBot: null,
      signal: null,
    },
  });
  const bucketed = [
    entry("d", "decisionMade", "Dan", 3),
    entry("a", "announcement", "Carla", 2),
    entry("q", "needsYou", "Bob", 1),
    entry("f", "fyi", "Eve", 0),
  ];

  it("puts what waits on the reader first and keeps uncovered news on its own", () => {
    const topics = buildChatCatchUpTopics(
      [
        {
          title: "Launch plan",
          summary: "Dan picked B.",
          status: "decided",
          messageIds: ["d"],
        },
        {
          title: "Pricing sheet",
          summary: "Bob needs it.",
          status: "fyi",
          messageIds: ["d", "q"],
        },
      ],
      bucketed,
      new Map(),
    );
    expect(topics.map((topic) => [topic.title, topic.status])).toEqual([
      // A needs-you message makes it wait on the reader.
      ["Pricing sheet", "waitingOnYou"],
      ["Launch plan", "decided"],
      // The announcement no topic covered; the plain fyi stays out.
      ["Carla", "fyi"],
    ]);
    const pricing = topics[0];
    // Oldest first, everyone once, with their picture.
    expect(pricing.messages.map((item) => item.messageId)).toEqual(["q", "d"]);
    expect(pricing.people).toEqual([
      { name: "Bob", imageUrl: "https://img/Bob" },
      { name: "Dan", imageUrl: "https://img/Dan" },
    ]);
    expect(pricing.id).toBe("q");
    expect(pricing.latestAt).toEqual(new Date(Date.UTC(2026, 9, 30, 9, 3)));
  });

  it("trusts the model when it says a topic waits on the reader", () => {
    const [topic] = buildChatCatchUpTopics(
      [{ title: "x", summary: "y", status: "waitingOnYou", messageIds: ["f"] }],
      bucketed.filter((item) => item.message.id === "f"),
      new Map(),
    );
    expect(topic.status).toBe("waitingOnYou");
  });
});
