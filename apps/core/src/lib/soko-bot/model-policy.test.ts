import { generateText, tool, wrapLanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  sokoBotInferenceEvidence,
  sokoBotModelRequest,
  sokoBotRegionMiddleware,
} from "./model-policy";

describe("Soko Bot EU model policy", () => {
  it("rejects explicit regional mismatch before the SDK executes a returned tool call", async () => {
    const execute = vi.fn();
    const model = wrapLanguageModel({
      model: new MockLanguageModelV3({
        doGenerate: {
          content: [
            {
              type: "tool-call",
              toolCallId: "call-one",
              toolName: "mutate",
              input: "{}",
            },
          ],
          finishReason: { unified: "tool-calls", raw: "tool-calls" },
          usage: {
            inputTokens: {
              total: 1,
              noCache: 1,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: { total: 1, text: 1, reasoning: undefined },
          },
          warnings: [],
          providerMetadata: {
            gateway: {
              routing: {
                modelAttempts: [
                  {
                    providerAttempts: [
                      {
                        provider: "vertex",
                        inferenceEndpoint: { geoRegion: "us" },
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
      }),
      middleware: sokoBotRegionMiddleware,
    });
    await expect(
      generateText({
        model,
        prompt: "Synthetic task",
        maxRetries: 0,
        tools: { mutate: tool({ inputSchema: z.object({}), execute }) },
      }),
    ).rejects.toThrow("not approved");
    expect(execute).not.toHaveBeenCalled();
  });
  it.each(["agent", "judge"] as const)(
    "pins %s requests with no SDK retries",
    (role) => {
      expect(
        sokoBotModelRequest({ role, model: "google/gemini-3.6-flash" }),
      ).toEqual({
        model: expect.objectContaining({
          modelId: "google/gemini-3.6-flash",
          specificationVersion: "v4",
        }),
        maxRetries: 0,
        providerOptions: {
          gateway: {
            inferenceRegion: { scope: "zone", geoRegion: "eu" },
            only: ["vertex"],
          },
        },
      });
    },
  );
  it.each([
    "typesafe-ai/jev",
    "mistral/mistral-small",
    "virtual/customer-model",
    "toString",
  ])("rejects unsupported model %s", (model) => {
    expect(() => sokoBotModelRequest({ role: "agent", model })).toThrow(
      "not approved",
    );
  });
  it("rejects a region override and an unsupported structured-output role", () => {
    expect(() =>
      sokoBotModelRequest({
        role: "agent",
        model: "google/gemini-3.6-flash",
        inferenceRegion: "us",
      }),
    ).toThrow();
    expect(() =>
      sokoBotModelRequest({
        role: "judge",
        model: "anthropic/claude-opus-5.5",
      }),
    ).toThrow();
  });
  it("records absent metadata as unknown, not proof of EU inference", () => {
    expect(sokoBotInferenceEvidence(undefined).regionStatus).toBe("UNKNOWN");
  });
  it("retains bounded routing evidence and detects regional mismatch", () => {
    const evidence = sokoBotInferenceEvidence({
      gateway: {
        prompt: "private",
        routing: {
          finalProvider: "vertex",
          modelAttempts: [
            {
              providerAttempts: [
                { provider: "vertex" },
                { provider: "vertex", inferenceEndpoint: { geoRegion: "us" } },
              ],
            },
          ],
        },
      },
    });
    expect(evidence.regionStatus).toBe("MISMATCH");
    expect(JSON.stringify(evidence)).not.toContain("private");
  });
});
