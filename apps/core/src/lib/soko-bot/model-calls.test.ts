import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectCoreLogWhys } from "@/test/core-log";

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({
  default: { sokoBotModelCall: { create } },
}));

import {
  gatewayCallFacts,
  modelCallTelemetry,
  recordModelCall,
  withModelCallTurn,
} from "./model-calls";

/** What the Gateway reports on a call that fell back to a second model. */
const FELL_BACK = {
  gateway: {
    routing: {
      originalModelId: "google/gemini-4-carbon",
      canonicalSlug: "google/gemini-4-carbon",
      finalProvider: "vertex",
      modelAttempts: [
        {
          canonicalSlug: "google/gemini-4-carbon",
          success: false,
          providerAttempts: [{ provider: "vertex", success: false }],
        },
        {
          canonicalSlug: "google/gemini-4-hydrogen",
          success: true,
          providerAttempts: [
            {
              provider: "vertex",
              success: true,
              inferenceEndpoint: { geoRegion: "eu" },
            },
          ],
        },
      ],
    },
    cost: "0.0012",
    enabledZeroDataRetention: true,
    generationId: "gen_1",
  },
};

beforeEach(() => create.mockReset().mockResolvedValue({}));

describe("gatewayCallFacts", () => {
  it("names the model and provider that answered, not the one asked for", () => {
    expect(gatewayCallFacts(FELL_BACK)).toEqual({
      requestedModel: "google/gemini-4-carbon",
      answeredModel: "google/gemini-4-hydrogen",
      provider: "vertex",
      region: "eu",
      zeroDataRetention: true,
      generationId: "gen_1",
    });
  });

  it("keeps what it can read when one field is odd", () => {
    const odd = structuredClone(FELL_BACK) as any;
    odd.gateway.routing.modelAttempts[1].providerAttempts[0].inferenceEndpoint =
      { geoRegion: null };
    expect(gatewayCallFacts(odd)).toMatchObject({
      answeredModel: "google/gemini-4-hydrogen",
      provider: "vertex",
      region: null,
    });
  });

  it("reports nothing it was not told", () => {
    expect(gatewayCallFacts(undefined)).toEqual({
      requestedModel: null,
      answeredModel: null,
      provider: null,
      region: null,
      zeroDataRetention: null,
      generationId: null,
    });
  });
});

describe("recordModelCall", () => {
  it("records nothing outside a turn", async () => {
    await recordModelCall({ role: "check", requestedModel: "openai/x" });
    expect(create).not.toHaveBeenCalled();
  });

  it("records on the turn whose work made the call, with its cost", async () => {
    await withModelCallTurn("turn-1", () =>
      recordModelCall({
        role: "agent",
        requestedModel: "google/gemini-4-carbon",
        providerMetadata: FELL_BACK,
        usage: { inputTokens: 100, cacheReadTokens: 80, outputTokens: 5 },
      }),
    );
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        turnId: "turn-1",
        role: "agent",
        requestedModel: "google/gemini-4-carbon",
        answeredModel: "google/gemini-4-hydrogen",
        provider: "vertex",
        region: "eu",
        inputTokens: 100,
        cacheReadTokens: 80,
        outputTokens: 5,
        costUsdMicros: 1200n,
      }),
    });
  });

  it("never fails the turn when the record cannot be written", async () => {
    expectCoreLogWhys("warn", "A Soko Bot model call was not recorded", [
      "Writing soko_bot_model_call failed",
    ]);
    create.mockRejectedValueOnce(new Error("db down"));
    await expect(
      recordModelCall({
        turnId: "turn-1",
        role: "check",
        requestedModel: "openai/x",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("modelCallTelemetry", () => {
  it("records every language-model call of a turn under its role", async () => {
    await withModelCallTurn("turn-2", async () => {
      await modelCallTelemetry.onLanguageModelCallEnd?.({
        functionId: "soko-bot-judge",
        modelId: "anthropic/claude-opus-5.5",
        providerMetadata: FELL_BACK,
        usage: { inputTokens: 10, outputTokens: 2 },
      } as never);
      await modelCallTelemetry.onLanguageModelCallEnd?.({
        modelId: "gpt-6-luna",
        providerMetadata: {
          gateway: { routing: { originalModelId: "openai/gpt-6-luna" } },
        },
        usage: { inputTokens: 3, outputTokens: 1 },
      } as never);
      await modelCallTelemetry.experimental_onDecisionModelCallEnd?.({
        modelId: "typesafe-ai/jev",
        usage: { inputTokens: 7 },
      } as never);
    });
    expect(create.mock.calls.map(([call]) => call.data.role)).toEqual([
      "judge",
      "check",
      "check",
    ]);
    expect(create.mock.calls[1]?.[0].data.requestedModel).toBe(
      "openai/gpt-6-luna",
    );
    expect(create.mock.calls[2]?.[0].data).toMatchObject({
      turnId: "turn-2",
      label: "jev",
      requestedModel: "typesafe-ai/jev",
      inputTokens: 7,
    });
  });
});
