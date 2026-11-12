import { APICallError, gateway } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, gateway: { languageModel: vi.fn() } };
});

import {
  AD_EVAL_JUDGE_MODEL,
  adEvalJudgeSchema,
  getAdEvalJudgePrior,
  judgeAdImage,
} from "./ad-eval-judge";

const VERDICT = {
  criteria: {
    brief_adherence: { score: 4, reason: "The requested product is centered." },
    brand_fit: { score: 4, reason: "Palette matches the brand." },
    composition: { score: 5, reason: "Clear hierarchy and spacing." },
    text_quality: { score: 4, reason: "Headline is readable." },
    product_fidelity: { score: 4, reason: "Matches the reference shape." },
    ad_effectiveness: { score: 4, reason: "The product is the focal point." },
  },
  overall: 4.2,
  issues: [],
  observations: {
    text: ["Fresh every day"],
    garbledText: false,
    safe: true,
    logoPresent: null,
  },
};

const INPUT = {
  image: new Uint8Array([255, 216, 255]),
  finalPrompt: "A blue product advertisement. Render Fresh every day.",
  brandLook: { colors: ["#0000ff"] },
  headline: "Fresh every day",
  approvedLines: ["Fresh every day"],
};

function mockModel(
  text = JSON.stringify(VERDICT),
  cost: string | number | undefined = "0.0123451",
) {
  const model = new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 200, text: 200, reasoning: 0 },
      },
      warnings: [],
      providerMetadata: { gateway: cost === undefined ? {} : { cost } },
    },
  });
  vi.mocked(gateway.languageModel).mockReturnValue(model);
  return model;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ad image vision judge", () => {
  it("scores and transcribes in one bounded EU/ZDR structured vision call", async () => {
    const model = mockModel();
    const result = await judgeAdImage({
      ...INPUT,
      referenceImage: INPUT.image,
      logoRequested: true,
    });

    expect(result).toEqual({
      judge: VERDICT,
      rawJson: VERDICT,
      judgeModel: AD_EVAL_JUDGE_MODEL,
      costUsdMicros: 12_346n,
      latencyMs: expect.any(Number),
    });
    expect(gateway.languageModel).toHaveBeenCalledExactlyOnceWith(
      AD_EVAL_JUDGE_MODEL,
    );
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(model.doGenerateCalls[0]?.prompt).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "system",
          content: expect.stringContaining(
            "The composited product is expected, not a brief violation.",
          ),
        }),
      ]),
    );
    expect(model.doGenerateCalls[0]).toMatchObject({
      temperature: 0,
      maxOutputTokens: 2_000,
      responseFormat: { type: "json", schema: expect.any(Object) },
      providerOptions: {
        gateway: {
          only: ["vertex", "bedrock"],
          inferenceRegion: { scope: "zone", geoRegion: "eu" },
          zeroDataRetention: true,
          disallowPromptTraining: true,
        },
      },
      abortSignal: expect.any(AbortSignal),
    });
    const userMessage = model.doGenerateCalls[0]?.prompt.find(
      (message) => message.role === "user",
    );
    expect(userMessage?.content).toHaveLength(3);
    expect(userMessage?.content[0]).toEqual({
      type: "text",
      text: JSON.stringify({
        finalPrompt: INPUT.finalPrompt,
        brandLook: INPUT.brandLook,
        headline: INPUT.headline,
        approvedLines: INPUT.approvedLines,
        useProductCutout: false,
        logoRequested: true,
      }),
    });
  });

  it.each(["{bad json", JSON.stringify({ ...VERDICT, overall: 6 })])(
    "rejects malformed or out-of-rubric output without another call",
    async (text) => {
      const model = mockModel(text);
      await expect(judgeAdImage(INPUT)).rejects.toThrow();
      expect(model.doGenerateCalls).toHaveLength(1);
    },
  );

  it("keeps unsafe and garbled observations for the hard checks", async () => {
    const verdict = {
      ...VERDICT,
      observations: {
        text: ["Fr3sh evry dyy"],
        safe: false,
        garbledText: true,
        logoPresent: false,
      },
    };
    mockModel(JSON.stringify(verdict));
    expect((await judgeAdImage(INPUT)).judge.observations).toEqual(
      verdict.observations,
    );
  });

  it.each(["-1", "not-a-number", "Infinity", "", " "])(
    "leaves an invalid cost (%j) unknown for the reservation",
    async (cost) => {
      mockModel(JSON.stringify(VERDICT), cost);
      expect((await judgeAdImage(INPUT)).costUsdMicros).toBeNull();
    },
  );

  it("leaves absent cost unknown and accepts an explicitly reported zero", async () => {
    const model = mockModel();
    model.doGenerate = async () => ({
      content: [{ type: "text", text: JSON.stringify(VERDICT) }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 0, text: 0, reasoning: 0 },
      },
      warnings: [],
    });
    expect((await judgeAdImage(INPUT)).costUsdMicros).toBeNull();
    mockModel(JSON.stringify(VERDICT), 0);
    expect((await judgeAdImage(INPUT)).costUsdMicros).toBe(0n);
  });

  it("does not retry a retryable provider failure", async () => {
    const model = mockModel();
    const fail = vi.fn().mockRejectedValue(
      new APICallError({
        message: "Unavailable",
        url: "https://example.com/model",
        requestBodyValues: {},
        statusCode: 503,
        isRetryable: true,
      }),
    );
    model.doGenerate = fail;
    await expect(judgeAdImage(INPUT)).rejects.toThrow("Unavailable");
    expect(fail).toHaveBeenCalledOnce();
  });

  it.each([
    { finalPrompt: "x".repeat(32_001) },
    { finalPrompt: "\u0000".repeat(32_000) },
    { brandLook: { description: "x".repeat(8_001) } },
    { approvedLines: ["x".repeat(4_000)] },
    { image: new Uint8Array(2 * 1024 * 1024 + 1) },
  ])("rejects oversized input before spending", async (oversized) => {
    const model = mockModel();
    await expect(judgeAdImage({ ...INPUT, ...oversized })).rejects.toThrow();
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(gateway.languageModel).not.toHaveBeenCalled();
  });

  it.each(["", "   ", "First line\nSecond line", "A reason\n"])(
    "rejects an empty or multiline reason (%j)",
    (reason) => {
      expect(
        adEvalJudgeSchema.safeParse({
          ...VERDICT,
          criteria: {
            ...VERDICT.criteria,
            composition: { score: 4, reason },
          },
        }).success,
      ).toBe(false);
    },
  );

  it("preserves whitespace in the raw judge JSON and rejects blank issue tags", async () => {
    const verdict = {
      ...VERDICT,
      issues: ["  cropped product  "],
      criteria: {
        ...VERDICT.criteria,
        composition: { score: 4, reason: "  The layout is balanced.  " },
      },
    };
    mockModel(JSON.stringify(verdict));
    expect((await judgeAdImage(INPUT)).rawJson).toEqual(verdict);
    expect(
      adEvalJudgeSchema.safeParse({ ...verdict, issues: [" "] }).success,
    ).toBe(false);
  });
});

describe("ad judge ranking prior", () => {
  it.each([
    [1, 0],
    [3, 0.5],
    [5, 1],
    [10, 1],
    [null, null],
    [undefined, null],
    [Number.NaN, null],
  ])("normalizes %s to %s", (overall, expected) => {
    expect(getAdEvalJudgePrior(overall)).toBe(expected);
  });
});
