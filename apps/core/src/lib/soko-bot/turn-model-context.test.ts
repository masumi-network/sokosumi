import { describe, expect, it } from "vitest";
import { contextBlock, latestExchange } from "./turn-model-context";

describe("contextBlock", () => {
  it("states the reply language last, after the packet and the latest exchange", () => {
    const now = Date.parse("2026-09-30T21:27:00Z");
    const lines = contextBlock(
      {
        recentTurns: [
          {
            source: "CHAT",
            userMessage: "Erinnere mich jeden Montag.",
            finalAnswer: "Soll ich das so einrichten?",
            completedAt: "2026-09-30T21:26:00Z",
          },
        ],
      },
      '{"memory":"Standup auf Deutsch"}',
      now,
    );
    const language = lines.findIndex((line) =>
      line.startsWith("Reply in the language of the owner's latest message"),
    );
    expect(language).toBe(lines.length - 1);
    expect(lines.findIndex((line) => line.startsWith("You: Soll ich"))).toBe(
      language - 2,
    );
  });
});

describe("latestExchange", () => {
  const now = Date.parse("2026-09-30T18:05:14Z");
  const offer = {
    source: "CHAT",
    userMessage: "Swap Gravity for a better one and update the file.",
    finalAnswer: `${"Research table… ".repeat(60)}Want me to replace the Gravity row in competitors-r5.md?`,
    completedAt: "2026-09-30T18:03:40Z",
  };

  it("repeats the bot's own offer in full, so a bare yes can answer it", () => {
    const block = latestExchange({ recentTurns: [offer] }, now).join("\n");
    expect(block).toContain("LATEST EXCHANGE");
    expect(block).toContain(
      "Want me to replace the Gravity row in competitors-r5.md?",
    );
    expect(block).toContain(`Owner: ${offer.userMessage}`);
  });

  it("repeats a post the bot made on its own, without Core's prompt", () => {
    const block = latestExchange(
      {
        recentTurns: [
          {
            ...offer,
            source: "INGEST",
            userMessage: "New mail arrived that looks important…",
            finalAnswer:
              "DigitalOcean — masumi-payment-dev: deployment failed.",
          },
        ],
      },
      now,
    ).join("\n");
    expect(block).toContain(
      "You, posted on your own (ingest): DigitalOcean — masumi-payment-dev: deployment failed.",
    );
    expect(block).not.toContain("Owner:");
  });

  it("repeats every post the bot made on its own since the owner last wrote", () => {
    const post = (source: string, finalAnswer: string) => ({
      ...offer,
      source,
      finalAnswer,
    });
    const block = latestExchange(
      {
        recentTurns: [
          offer,
          post("INGEST", "Make — s_New_Registration: two recent errors."),
          post("INGEST", "DigitalOcean — masumi-payment-dev: deploy failed."),
          post("SCHEDULE", "End of day: one Task completed."),
        ],
      },
      now,
    ).join("\n");
    expect(block).not.toContain("Owner:");
    expect(block).not.toContain("Want me to replace");
    for (const line of [
      "You, posted on your own (ingest): Make — s_New_Registration: two recent errors.",
      "You, posted on your own (ingest): DigitalOcean — masumi-payment-dev: deploy failed.",
      "You, posted on your own (schedule): End of day: one Task completed.",
    ])
      expect(block).toContain(line);
  });

  it("stays out when the last turn is a day old or missing", () => {
    const exchange = (turns: unknown[]) =>
      latestExchange({ recentTurns: turns }, now);
    expect(
      exchange([{ ...offer, completedAt: "2026-09-28T18:00:00Z" }]),
    ).toEqual([]);
    expect(exchange([])).toEqual([]);
    expect(latestExchange({ memory: {} }, now)).toEqual([]);
  });
});
