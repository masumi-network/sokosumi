import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import * as env from "@/config/env";
import {
  contextBlock,
  latestExchange,
  modelContextBlock,
} from "./turn-model-context";

describe("contextBlock", () => {
  it("states the reply language last, after the packet and the latest exchange", () => {
    const now = Date.parse("2026-09-30T21:27:00Z");
    const lines = contextBlock(
      {
        memory: "Standup auf Deutsch",
        recentTurns: [
          {
            source: "CHAT",
            userMessage: "Erinnere mich jeden Montag.",
            finalAnswer: "Soll ich das so einrichten?",
            completedAt: "2026-09-30T21:26:00Z",
          },
        ],
      },
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

describe("modelContextBlock", () => {
  it("keeps a prior assistant claim as conversation history and directs ordinary identity questions to their source", () => {
    const staleClaim = "Micah Vale works at Cerise Paper.";
    const packet = {
      recentTurns: [{ source: "SCHEDULE", finalAnswer: staleClaim }],
    };
    const chat = modelContextBlock(packet, false).join("\n");
    expect(chat).toContain(staleClaim);
    expect(chat).toMatch(/search_contacts/);
    expect(chat).toMatch(/list_calendar_events/);
    expect(chat).toContain("attendeesIncomplete");
    expect(chat).toContain("contactReferences");
    const meeting = modelContextBlock(packet, true).join("\n");
    expect(meeting).not.toContain(staleClaim);
    expect(meeting).not.toMatch(/search_contacts|list_calendar_events/);
  });

  it("cannot reintroduce an unrelated person's name from a recent turn excluded by an evaluation allowance", () => {
    const deployment = {
      branch: "identity-fixture",
      sourceSha: "a".repeat(40),
    };
    const binding = {
      ...deployment,
      reservationId: randomUUID(),
      userId: randomUUID(),
      botId: randomUUID(),
      taskIds: [randomUUID()],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const originalEnv = env.getEnv();
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", deployment.sourceSha);
    vi.stubEnv("VERCEL_GIT_COMMIT_REF", deployment.branch);
    const getEnv = vi.spyOn(env, "getEnv").mockReturnValue({
      ...originalEnv,
      NETWORK: "Preprod",
      SOKO_BOT_PROACTIVE_PAUSED: true,
      SOKO_BOT_EVALUATION_ALLOWANCE: JSON.stringify(binding),
    });
    try {
      const lines = modelContextBlock(
        {
          trigger: { source: "CHAT" },
          tasks: [],
          recentTurns: [
            {
              source: "CHAT",
              finalAnswer: "An unrelated guest was Mel Indigo.",
              completedAt: new Date().toISOString(),
            },
          ],
        },
        false,
      );
      expect(lines.join("\n")).not.toContain("Mel Indigo");
    } finally {
      getEnv.mockRestore();
      vi.unstubAllEnvs();
    }
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
