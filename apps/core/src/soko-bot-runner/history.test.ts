import type { ModelMessage, ToolResultPart } from "ai";
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

  it("keeps the latest plan whole on a planLoop turn, and only the latest", () => {
    const big = "x".repeat(5_000);
    const plan = (id: string): ModelMessage[] =>
      toolRound(id, big).map((message) =>
        message.role === "tool"
          ? {
              ...message,
              content: message.content.map((part) => ({
                ...part,
                toolName: "update_plan",
              })),
            }
          : message,
      );
    const messages: ModelMessage[] = [
      { role: "user", content: "Do the three things" },
      ...plan("p1"),
      ...plan("p2"),
      ...Array.from({ length: 8 }, (_, i) => toolRound(`c${i}`, big)).flat(),
    ];
    const kept = (compacted: ModelMessage[] | null) =>
      compacted?.flatMap((message) =>
        message.role === "tool"
          ? message.content.flatMap((part) =>
              part.type === "tool-result" &&
              part.toolName === "update_plan" &&
              part.output.type === "json"
                ? [part.toolCallId]
                : [],
            )
          : [],
      );
    expect(
      kept(compactHistory(messages, 20_000, { keepLatestPlan: true })),
    ).toEqual(["p2"]);
    expect(kept(compactHistory(messages, 20_000))).toEqual([]);
  });

  it("keeps the accepted plan whole after a refused one, and nothing beside it", () => {
    const big = "x".repeat(5_000);
    const result = (
      id: string,
      toolName: string,
      output: ToolResultPart["output"],
    ): ToolResultPart => ({
      type: "tool-result",
      toolCallId: id,
      toolName,
      output,
    });
    const messages: ModelMessage[] = [
      { role: "user", content: "Do the three things" },
      {
        role: "tool",
        content: [
          result("plan-ok", "update_plan", {
            type: "json",
            value: { plan: big },
          }),
          result("read", "search_inbox", {
            type: "json",
            value: { messages: big },
          }),
        ],
      },
      {
        role: "tool",
        content: [
          result("plan-refused", "update_plan", {
            type: "error-text",
            value: `The plan is at revision 2 ${big}`,
          }),
        ],
      },
      ...Array.from({ length: 8 }, (_, i) => toolRound(`c${i}`, big)).flat(),
    ];
    const compacted = compactHistory(messages, 20_000, {
      keepLatestPlan: true,
    });
    const outputs = Object.fromEntries(
      (compacted ?? []).flatMap((message) =>
        message.role === "tool"
          ? message.content.flatMap((part) =>
              part.type === "tool-result"
                ? [[part.toolCallId, part.output.type]]
                : [],
            )
          : [],
      ),
    );
    expect(outputs["plan-ok"]).toBe("json");
    expect(outputs.read).toBe("text");
    // Shortened, the refusal is still an error, so compacting again keeps
    // the accepted plan, not the refusal, as the plan.
    expect(outputs["plan-refused"]).toBe("error-text");
    const again = compactHistory(compacted ?? [], 20_000, {
      keepLatestPlan: true,
    });
    const kept = (again ?? compacted ?? [])
      .flatMap((message) => (message.role === "tool" ? message.content : []))
      .find(
        (part) => part.type === "tool-result" && part.toolCallId === "plan-ok",
      );
    expect(kept?.type === "tool-result" && kept.output.type).toBe("json");
  });

  it("counts only what the turn added after its first message", () => {
    // A strategy turn's preloaded skills and packet open its first message.
    const opening = `${"skill ".repeat(15_000)}LATE RULE`;
    const messages: ModelMessage[] = [
      { role: "user", content: opening },
      ...Array.from({ length: 8 }, (_, i) =>
        toolRound(`c${i}`, "small"),
      ).flat(),
    ];
    expect(JSON.stringify(messages).length).toBeGreaterThan(80_000);
    expect(compactHistory(messages)).toBeNull();
  });

  it("keeps a skill the model read whole, however old", () => {
    const skill = `# Strategy\n${"rule ".repeat(10_000)}LAST RULE`;
    const read: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "s",
            toolName: "read_skill",
            input: { skill: "cmo-strategy-v22" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "s",
            toolName: "read_skill",
            output: { type: "json", value: { content: skill } },
          },
        ],
      },
    ];
    const messages: ModelMessage[] = [
      { role: "user", content: "Why these pillars?" },
      ...read,
      ...Array.from({ length: 16 }, (_, i) =>
        toolRound(`c${i}`, "x".repeat(5_000)),
      ).flat(),
    ];
    const compacted = compactHistory(messages, 20_000);
    expect(compacted?.[2]).toEqual(read[1]);
    expect(JSON.stringify(compacted?.[2])).toContain("LAST RULE");
    const searched = compacted?.[4];
    expect(
      searched?.role === "tool" &&
        searched.content[0]?.type === "tool-result" &&
        searched.content[0].output.type,
    ).toBe("text");
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
