import type {
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
} from "@ai-sdk/provider";
import { describe, expect, it, vi } from "vitest";

import { COWORKER_AGENT_ERROR_SNIPPET } from "../coworker-agent-error.js";
import {
  COWORKER_CONVERSATION_MAX_RETRIES,
  withConversationCommitPolicy,
} from "./conversation-commit-policy.js";

type TestPart =
  | { type: "stream-start"; warnings: [] }
  | { type: "text-delta"; delta: string }
  | { type: "finish" };

function asPart(part: TestPart): LanguageModelV4StreamPart {
  return part as LanguageModelV4StreamPart;
}

function partsStream(
  parts: TestPart[],
): ReadableStream<LanguageModelV4StreamPart> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(asPart(part));
      }
      controller.close();
    },
  });
}

function streamResult(parts: TestPart[]): LanguageModelV4StreamResult {
  return {
    stream: partsStream(parts),
    request: { body: {} },
    response: { headers: {} },
  };
}

function textParts(text: string): TestPart[] {
  return [
    { type: "stream-start", warnings: [] },
    { type: "text-delta", delta: text },
    { type: "finish" },
  ];
}

async function collectText(
  stream: ReadableStream<LanguageModelV4StreamPart>,
): Promise<string> {
  const reader = stream.getReader();
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value.type === "text-delta") {
        text += value.delta;
      }
    }
  } finally {
    reader.releaseLock();
  }
  return text;
}

describe("withConversationCommitPolicy", () => {
  it("exports conversation max retries of 2", () => {
    expect(COWORKER_CONVERSATION_MAX_RETRIES).toBe(2);
  });

  it("returns the protocol stream without opening extra attempts on good output", async () => {
    const openStream = vi.fn(async () =>
      streamResult(
        textParts("This is a complete coworker reply with enough text."),
      ),
    );

    const result = await withConversationCommitPolicy(openStream);

    expect(openStream).toHaveBeenCalledTimes(1);
    const text = await collectText(result.stream);
    expect(text).toBe("This is a complete coworker reply with enough text.");
  });

  it("retries on agent-error text and emits only the successful attempt text", async () => {
    let call = 0;
    const openStream = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return streamResult(
          textParts(`${COWORKER_AGENT_ERROR_SNIPPET}. Please try again.`),
        );
      }
      return streamResult(
        textParts("This is a complete coworker reply with enough text."),
      );
    });

    const result = await withConversationCommitPolicy(openStream);
    const text = await collectText(result.stream);

    expect(openStream).toHaveBeenCalledTimes(2);
    expect(text).toBe("This is a complete coworker reply with enough text.");
  });

  it("retries on short-tail text", async () => {
    let call = 0;
    const openStream = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return streamResult(textParts("Done"));
      }
      return streamResult(
        textParts("This is a complete coworker reply with enough text."),
      );
    });

    const result = await withConversationCommitPolicy(openStream);
    const text = await collectText(result.stream);

    expect(openStream).toHaveBeenCalledTimes(2);
    expect(text).toBe("This is a complete coworker reply with enough text.");
  });

  it("stops after maxRetries + initial attempt (3 opens max)", async () => {
    const openStream = vi.fn(async () => streamResult(textParts("Done")));

    const result = await withConversationCommitPolicy(openStream, {
      maxRetries: COWORKER_CONVERSATION_MAX_RETRIES,
    });
    const text = await collectText(result.stream);

    // attempt 0 gated, 1 gated, 2 final ungated → 3 opens
    expect(openStream).toHaveBeenCalledTimes(3);
    expect(text).toBe("Done");
  });

  it("with maxRetries 0 returns the first stream without gating retry", async () => {
    const openStream = vi.fn(async () =>
      streamResult(
        textParts(`${COWORKER_AGENT_ERROR_SNIPPET}. Please try again.`),
      ),
    );

    const result = await withConversationCommitPolicy(openStream, {
      maxRetries: 0,
    });
    const text = await collectText(result.stream);

    expect(openStream).toHaveBeenCalledTimes(1);
    expect(text).toContain(COWORKER_AGENT_ERROR_SNIPPET);
  });

  it("treats negative maxRetries as 0 (single open, no gate retry)", async () => {
    const openStream = vi.fn(async () =>
      streamResult(
        textParts(`${COWORKER_AGENT_ERROR_SNIPPET}. Please try again.`),
      ),
    );

    const result = await withConversationCommitPolicy(openStream, {
      maxRetries: -1,
    });
    const text = await collectText(result.stream);

    expect(openStream).toHaveBeenCalledTimes(1);
    expect(text).toContain(COWORKER_AGENT_ERROR_SNIPPET);
  });

  it.each([Number.POSITIVE_INFINITY, Number.NaN] as const)(
    "treats non-finite maxRetries %s as 0 (no unbounded reopen)",
    async (maxRetries) => {
      const openStream = vi.fn(async () =>
        streamResult(
          textParts(`${COWORKER_AGENT_ERROR_SNIPPET}. Please try again.`),
        ),
      );

      const result = await withConversationCommitPolicy(openStream, {
        maxRetries,
      });
      const text = await collectText(result.stream);

      expect(openStream).toHaveBeenCalledTimes(1);
      expect(text).toContain(COWORKER_AGENT_ERROR_SNIPPET);
    },
  );

  it("truncates fractional maxRetries to an integer budget", async () => {
    const openStream = vi.fn(async () => streamResult(textParts("Done")));

    const result = await withConversationCommitPolicy(openStream, {
      maxRetries: 1.9,
    });
    const text = await collectText(result.stream);

    // trunc(1.9) → 1: attempt 0 gated + attempt 1 final ungated
    expect(openStream).toHaveBeenCalledTimes(2);
    expect(text).toBe("Done");
  });
});
