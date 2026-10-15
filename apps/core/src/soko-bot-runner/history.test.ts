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

  it("shortens old call inputs and drops old reasoning", () => {
    const rows = "r".repeat(5_000);
    const write = (id: string): ModelMessage[] => [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "thinking ".repeat(300) },
          {
            type: "tool-call",
            toolCallId: id,
            toolName: "write_table_rows",
            input: { rows },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: id,
            toolName: "write_table_rows",
            output: { type: "json", value: { ok: true } },
          },
        ],
      },
    ];
    const messages = Array.from({ length: 20 }, (_, i) =>
      write(`w${i}`),
    ).flat();
    const compacted = compactHistory(messages, 20_000) ?? [];
    const first = compacted[0];
    expect(
      first?.role === "assistant" && Array.isArray(first.content)
        ? first.content.map((part) => part.type)
        : [],
    ).toEqual(["tool-call"]);
    expect(JSON.stringify(first).length).toBeLessThan(1_000);
    expect(compacted.at(-2)).toEqual(messages.at(-2));
  });

  it("keeps the shortened prefix identical while the next few steps add messages", () => {
    const big = "x".repeat(5_000);
    const history = (rounds: number): ModelMessage[] =>
      Array.from({ length: rounds }, (_, i) => toolRound(`c${i}`, big)).flat();
    // 26 and 28 messages share the boundary at 16.
    const before = compactHistory(history(13), 20_000) ?? [];
    const after = compactHistory(history(14), 20_000) ?? [];
    expect(after.slice(0, before.length)).toEqual(before);
  });
});
