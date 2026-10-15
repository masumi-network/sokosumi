import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import { compactHistory } from "./history";

function toolRound(id: string, value: string): ModelMessage[] {
  return [
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: id,
          toolName: "search_inbox",
          input: {},
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: id,
          toolName: "search_inbox",
          output: { type: "json", value: { messages: value } },
        },
      ],
    },
  ];
}

describe("compactHistory", () => {
  it("leaves a history that fits alone", () => {
    expect(compactHistory(toolRound("a", "short"), 10_000)).toBeNull();
  });

  it("shortens old tool results, keeps recent ones and every pairing", () => {
    const big = "x".repeat(5_000);
    const messages: ModelMessage[] = [
      { role: "user", content: "Build my CRM" },
      ...Array.from({ length: 8 }, (_, i) => toolRound(`c${i}`, big)).flat(),
    ];
    const compacted = compactHistory(messages, 20_000);
    expect(compacted).toHaveLength(messages.length);
    const results = compacted?.flatMap((message) =>
      message.role === "tool" ? message.content : [],
    );
    const first = results?.[0];
    const last = results?.at(-1);
    expect(first?.type === "tool-result" && first.output.type).toBe("text");
    expect(last?.type === "tool-result" && last.output.type).toBe("json");
    expect(compacted?.[0]).toEqual(messages[0]);
    expect(JSON.stringify(compacted).length).toBeLessThan(
      JSON.stringify(messages).length,
    );
  });
});
