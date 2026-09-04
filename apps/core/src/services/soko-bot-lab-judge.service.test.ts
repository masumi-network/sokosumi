import { sokoBotJudgeVerdictSchema } from "@sokosumi/soko-bot";
import { generateText, NoOutputGeneratedError, Output } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotTurn: { findFirst: vi.fn(), update: vi.fn() },
    sokoBotLabRun: { upsert: vi.fn() },
  },
}));

import { generateSokoBotJudgeText } from "./soko-bot-lab-judge.service";

const VALID_VERDICT = {
  scores: { delegation: 4, followThrough: 4, judgment: 4, honesty: 5 },
  verdict: "pass" as const,
  rationale: "Tasks were clear and claims matched tool results.",
  issues: [] as string[],
};

function usage(outputTotal: number, reasoning: number, text: number) {
  return {
    inputTokens: {
      total: 20,
      noCache: 20,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: { total: outputTotal, text, reasoning },
  };
}

/**
 * gpt-5.5-style: reasoning consumes a small maxOutputTokens cap, so the JSON
 * never arrives. No cap (production) leaves room for the verdict.
 */
function budgetSensitiveJudgeModel() {
  return new MockLanguageModelV3({
    doGenerate: async (options) => {
      if (options.maxOutputTokens != null && options.maxOutputTokens <= 800) {
        return {
          content: [
            {
              type: "reasoning",
              text: "scoring the turn against the rubric...",
            },
          ],
          finishReason: { unified: "length" as const, raw: "length" },
          usage: usage(800, 800, 0),
          warnings: [],
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(VALID_VERDICT) }],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage: usage(400, 100, 300),
        warnings: [],
      };
    },
  });
}

describe("soko-bot lab judge generateText", () => {
  it("throws AI_NoOutputGeneratedError when reasoning fills an 800-token cap", async () => {
    const resultPromise = generateText({
      model: budgetSensitiveJudgeModel(),
      output: Output.object({ schema: sokoBotJudgeVerdictSchema }),
      maxOutputTokens: 800,
      prompt: "{}",
    });

    await expect(
      resultPromise.then((result) => result.output),
    ).rejects.toSatisfy((error: unknown) =>
      NoOutputGeneratedError.isInstance(error),
    );
  });

  it("parses a verdict when the production judge call does not cap output tokens", async () => {
    const result = await generateSokoBotJudgeText({
      model: budgetSensitiveJudgeModel(),
      payload: {
        scenario: { id: "lab" },
        turn: { finalAnswer: "done" },
      },
    });

    expect(sokoBotJudgeVerdictSchema.parse(result.output)).toEqual(
      VALID_VERDICT,
    );
  });
});
