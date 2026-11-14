import {
  createEmptySokoBotMemory,
  projectSokoBotWebEvidence,
  renderSokoBotMemory,
  SOKO_BOT_SCENARIOS,
  sokoBotJudgeVerdictSchema,
} from "@sokosumi/soko-bot";
import { generateText, NoOutputGeneratedError, Output } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it, vi } from "vitest";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateText: vi.fn(actual.generateText) };
});

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotTurn: { findFirst: vi.fn(), update: vi.fn() },
    sokoBotLabRun: { upsert: vi.fn() },
    sokoBotMemoryRevision: { findFirst: vi.fn() },
  },
}));

import prisma from "@/lib/db/prisma";
import {
  generateSokoBotJudgeText,
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
    const instructions = vi
      .mocked(generateText)
      .mock.calls.at(-1)?.[0]?.instructions;
    expect(instructions).not.toContain("Nothing needs owner approval.");
    expect(instructions).toContain("Never require a forbidden tool");
    expect(generateText).toHaveBeenLastCalledWith(
      expect.objectContaining({
        model: expect.objectContaining({
          modelId: "anthropic/claude-haiku-4.5",
        }),
        maxRetries: 0,
        instructions: expect.stringContaining("missing text is not proof"),
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

  it.each([true, false])(
    "shows automatic memory capture only after revision verification (%s)",
    async (verified) => {
      const instruction = "Write Hannah's Task briefs in German.";
      const memory = createEmptySokoBotMemory();
      memory.preferences.push(instruction);
      const markdown = renderSokoBotMemory(memory);
      findTurn.mockResolvedValueOnce({
        sokoBotId: "bot-1",
        requestedByUserId: "user-1",
        source: "CHAT",
        status: "COMPLETED",
        route: "DIRECT_RESPONSE",
        userMessage: "Remember my preference.",
        finalAnswer: `Saved preference: ${JSON.stringify(instruction)}.`,
        versionId: "v38",
        sokoBot: { name: "Soko", userId: "user-1" },
        contextSnapshot: {
          packet: {
            trigger: {
              source: "CHAT",
              askedBy: { kind: "OWNER" },
              savedPreference: {
                instruction,
                memoryRevisionId: "11111111-1111-4111-8111-111111111111",
                memoryVersion: 2,
                memoryHash: "capture-hash",
              },
            },
            memory: { version: 3, hash: "later-dream-hash", markdown },
          },
        },
        toolCalls: [],
      } as never);
      vi.mocked(prisma.sokoBotMemoryRevision.findFirst).mockResolvedValueOnce(
        verified ? ({ markdown } as never) : null,
      );
      const payload = await loadLabJudgePayload("turn-memory", scenarioId);
      expect(payload.turn.coreActions).toEqual(
        verified ? [`Saved preference: ${JSON.stringify(instruction)}.`] : [],
      );
    },
  );

  it("flags evidence omitted by the shared judge budget on the actual payload", async () => {
    const result = {
      output: projectSokoBotWebEvidence({ text: "a".repeat(7_500) }),
      sources: [],
    };
    findTurn.mockResolvedValueOnce({
      sokoBotId: "bot-1",
      requestedByUserId: "user-1",
      source: "CHAT",
      status: "COMPLETED",
      route: "ANSWER",
      userMessage: "Compare the pages.",
      finalAnswer: "Comparison.",
      versionId: "version-1",
      sokoBot: { name: "Soko", userId: "user-1" },
      contextSnapshot: { packet: {} },
      toolCalls: Array.from({ length: 10 }, () => ({
        capability: "web_fetch",
        status: "COMPLETED",
        input: {},
        result,
        errorDetail: null,
      })),
    } as never);
    const payload = await loadLabJudgePayload("turn-3", scenarioId);
    expect(payload.turn.toolCalls).toHaveLength(10);
    expect(
      payload.turn.toolCalls.every((call) =>
        call.evidenceVisibility.reasons.includes("judge_budget_clipped"),
      ),
    ).toBe(true);
    expect(
      payload.turn.toolCalls.every((call) => !call.evidenceVisibility.complete),
    ).toBe(true);
  });

  it("passes forbidden hires and readiness rules to the scenario judge", async () => {
    findTurn.mockResolvedValueOnce({
      sokoBotId: "bot-1",
      requestedByUserId: "user-1",
      source: "CHAT",
      status: "COMPLETED",
      route: "DELEGATE_TASK",
      userMessage: "Start a research Task.",
      finalAnswer:
        "Created an unassigned draft because no researcher is available.",
      versionId: "v37",
      sokoBot: { name: "Soko", userId: "user-1" },
      contextSnapshot: { packet: { coworkers: [] } },
      toolCalls: [],
    } as never);
    const payload = await loadLabJudgePayload(
      "turn-research",
      "quick-research-task",
    );
    expect(payload.scenario.constraints.forbiddenTools).toContain("hire_agent");
    expect(payload.platformRules).toContain(
      "READY requires a verified assignee. Create new unassigned Tasks as DRAFT. Existing unassigned FAILED or INPUT_REQUIRED Tasks can retain their status while receiving guidance; never move an unassigned Task to READY.",
    );
    expect(payload.platformRules).toContain(
      "A marketplace listing is not an available teammate or permission to hire. Respect forbiddenTools, owner authorization, spending limits and workspace access.",
    );
  });

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
