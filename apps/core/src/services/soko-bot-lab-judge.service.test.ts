import {
  SOKO_BOT_SCENARIOS,
  sokoBotJudgeVerdictSchema,
} from "@sokosumi/soko-bot";
import { generateText, NoOutputGeneratedError, Output } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateText: vi.fn(actual.generateText) };
});

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotTurn: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    sokoBotLabRun: { upsert: vi.fn() },
    sokoBotModelCall: { create: vi.fn() },
  },
}));

vi.mock("@/lib/db/transaction", async () => {
  const { default: client } = await import("@/lib/db/prisma");
  return {
    serializableTransaction: (run: (tx: typeof client) => unknown) =>
      run(client),
  };
});

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return { ...actual, getEnv: vi.fn(actual.getEnv) };
});

vi.mock("@/lib/soko-bot/claude-code-judge", () => ({
  runClaudeCodeJudge: vi.fn(),
}));

import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";
import { runClaudeCodeJudge } from "@/lib/soko-bot/claude-code-judge";
import {
  generateSokoBotJudgeText,
  judgeEvalScenarioTurn,
  judgeSokoBotLabTurn,
  loadLabJudgePayload,
  SokoBotJudgeFailure,
  SokoBotLabJudgeError,
  sokoBotLabJudgeErrorKind,
} from "./soko-bot-lab-judge.service";

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
 * gpt-5.5-style: reasoning consumes maxOutputTokens, so the JSON never
 * arrives whenever a cap is set. No cap (production) leaves room for JSON.
 */
function budgetSensitiveJudgeModel() {
  return new MockLanguageModelV3({
    doGenerate: async (options) => {
      if (options.maxOutputTokens != null) {
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
  it("applies EU routing to the production judge call", async () => {
    const actual = await vi.importActual<typeof import("ai")>("ai");
    vi.mocked(generateText).mockImplementationOnce((options) =>
      actual.generateText({ ...options, model: budgetSensitiveJudgeModel() }),
    );
    await generateSokoBotJudgeText({
      model: "anthropic/claude-haiku-4.5",
      payload: {},
    });
    expect(generateText).toHaveBeenLastCalledWith(
      expect.objectContaining({
        model: expect.objectContaining({
          modelId: "anthropic/claude-haiku-4.5",
        }),
        maxRetries: 0,
        providerOptions: {
          gateway: {
            only: ["vertex", "bedrock"],
            inferenceRegion: { scope: "zone", geoRegion: "eu" },
          },
        },
      }),
    );
  });
  it.each([800, 8_000])(
    "throws AI_NoOutputGeneratedError when a %s-token cap is set",
    async (maxOutputTokens) => {
      const resultPromise = generateText({
        model: budgetSensitiveJudgeModel(),
        output: Output.object({ schema: sokoBotJudgeVerdictSchema }),
        maxOutputTokens,
        prompt: "{}",
      });

      await expect(
        resultPromise.then((result) => result.output),
      ).rejects.toSatisfy((error: unknown) =>
        NoOutputGeneratedError.isInstance(error),
      );
    },
  );

  it("parses a verdict without an output cap", async () => {
    const result = await generateText({
      model: budgetSensitiveJudgeModel(),
      output: Output.object({ schema: sokoBotJudgeVerdictSchema }),
      prompt: "{}",
    });

    expect(sokoBotJudgeVerdictSchema.parse(result.output)).toEqual(
      VALID_VERDICT,
    );
  });
});

describe("soko-bot judge failure reporting", () => {
  it("rejects an unapproved model before sending a request", async () => {
    await expect(
      generateSokoBotJudgeText({ model: "typesafe-ai/jev", payload: {} }),
    ).rejects.toThrow("not approved");
  });
  it("treats a judge miss as miss even though it is also a lab-judge error", () => {
    const miss = new SokoBotJudgeFailure("No output generated.", {
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    });
    expect(miss).toBeInstanceOf(SokoBotLabJudgeError);
    expect(sokoBotLabJudgeErrorKind(miss)).toBe("miss");
    expect(
      sokoBotLabJudgeErrorKind(new SokoBotLabJudgeError("Turn not found")),
    ).toBe("not_found");
    expect(sokoBotLabJudgeErrorKind(new Error("boom"))).toBeUndefined();
  });
});

describe("soko-bot lab judge transcript scope", () => {
  const scenarioId = SOKO_BOT_SCENARIOS[0]?.id ?? "missing";
  const findTurn = vi.mocked(prisma.sokoBotTurn.findFirst);

  it("keeps the member filter for any id the lab passes, even an empty one", async () => {
    findTurn.mockResolvedValueOnce(null);
    await expect(
      judgeSokoBotLabTurn({ userId: "", turnId: "turn-1", scenarioId }),
    ).rejects.toThrow("Turn not found");
    expect(findTurn.mock.calls.at(-1)?.[0]?.where).toEqual({
      id: "turn-1",
      requestedByUserId: "",
    });
  });

  it("reads any turn only for the admin payload", async () => {
    findTurn.mockResolvedValueOnce(null);
    await expect(loadLabJudgePayload("turn-2", scenarioId)).rejects.toThrow(
      "Turn not found",
    );
    expect(findTurn.mock.calls.at(-1)?.[0]?.where).toEqual({ id: "turn-2" });
  });
});

describe("soko-bot judge on Claude Code", () => {
  const scenario = SOKO_BOT_SCENARIOS[0];
  const realEnv = getEnv();

  function useClaudeCode(extra: Partial<typeof realEnv> = {}) {
    vi.mocked(getEnv).mockReturnValue({
      ...realEnv,
      SOKO_BOT_JUDGE_RUNNER: "claude-code",
      SOKO_BOT_JUDGE_CLAUDE_CODE_MODEL: "claude-opus-5-5",
      ...extra,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.sokoBotTurn.findFirst).mockResolvedValue({
      sokoBotId: "bot-1",
      requestedByUserId: "user-1",
      source: "CHAT",
      status: "COMPLETED",
      route: null,
      userMessage: "lab: plan the launch",
      finalAnswer: "Done.",
      versionId: "v1",
      sokoBot: { name: "Joseph", userId: "user-1" },
      toolCalls: [],
      contextSnapshot: null,
    } as never);
    vi.mocked(prisma.sokoBotTurn.findUnique).mockResolvedValue({
      usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.25 },
    } as never);
  });

  afterEach(() => {
    vi.mocked(getEnv).mockReturnValue(realEnv);
    vi.mocked(prisma.sokoBotTurn.findFirst).mockReset();
  });

  it("scores through the CLI, names the judge and adds no cost", async () => {
    useClaudeCode();
    vi.mocked(runClaudeCodeJudge).mockResolvedValue(VALID_VERDICT);

    const judged = await judgeEvalScenarioTurn("turn-1", scenario);

    expect(judged).toEqual({
      verdict: VALID_VERDICT,
      model: "claude-code:claude-opus-5-5",
    });
    expect(generateText).not.toHaveBeenCalled();
    expect(vi.mocked(runClaudeCodeJudge).mock.calls[0]?.[0]).toMatchObject({
      model: "claude-opus-5-5",
      timeoutMs: 90_000,
    });
    const update = vi.mocked(prisma.sokoBotTurn.update).mock.calls[0]?.[0];
    expect(update?.data).toMatchObject({
      qualityModel: "claude-code:claude-opus-5-5",
      qualityVerdict: VALID_VERDICT,
      usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.25 },
      overheadCostUsdMicros: { increment: 0n },
    });
  });

  it("retries once when the CLI's answer is not a verdict", async () => {
    useClaudeCode();
    vi.mocked(runClaudeCodeJudge)
      .mockResolvedValueOnce({ verdict: "maybe" })
      .mockResolvedValueOnce(VALID_VERDICT);

    const judged = await judgeEvalScenarioTurn("turn-1", scenario);

    expect(judged.verdict).toEqual(VALID_VERDICT);
    expect(runClaudeCodeJudge).toHaveBeenCalledTimes(2);
  });

  it("gives up after two failed CLI calls, without falling over to the Gateway", async () => {
    useClaudeCode();
    vi.mocked(runClaudeCodeJudge).mockRejectedValue(
      new Error("The claude CLI did not return a verdict: Not logged in"),
    );

    const failure = await judgeEvalScenarioTurn("turn-1", scenario).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(SokoBotJudgeFailure);
    expect((failure as SokoBotJudgeFailure).message).toContain("Not logged in");
    expect((failure as SokoBotJudgeFailure).usage.costUsd).toBe(0);
    expect(runClaudeCodeJudge).toHaveBeenCalledTimes(2);
    expect(generateText).not.toHaveBeenCalled();
    expect(prisma.sokoBotTurn.update).not.toHaveBeenCalled();
  });

  it("refuses to run on Vercel", async () => {
    useClaudeCode({ VERCEL_ENV: "production" });

    await expect(judgeEvalScenarioTurn("turn-1", scenario)).rejects.toThrow(
      "does not run on Vercel",
    );
    expect(runClaudeCodeJudge).not.toHaveBeenCalled();
    expect(generateText).not.toHaveBeenCalled();
  });
});
