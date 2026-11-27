import { describe, expect, it } from "vitest";
import type { ParityReport } from "./parity";
import { pricedUsd, priceKey, tokenPrice } from "./token-prices";
import { versionDelta } from "./version-delta";

describe("B6: tokens weighed by price", () => {
  it("bills only the uncached input at the full rate", () => {
    const luna = tokenPrice("gpt-6-luna")!;
    // 1M input of which 800k cached, 100k output.
    expect(
      pricedUsd(luna, {
        inputTokens: 1_000_000,
        cacheReadTokens: 800_000,
        cacheWriteTokens: 0,
        outputTokens: 100_000,
      }),
    ).toBeCloseTo(
      200_000 * 0.0000001 + 800_000 * 0.00000001 + 100_000 * 0.0000005,
      10,
    );
  });

  it("names one model however a run stored it, and prices none it doesn't know", () => {
    for (const id of [
      "gpt-6.1-terra",
      "openai/gpt-6.1-terra",
      "chatgpt-plan:gpt-6.1-terra",
    ])
      expect(priceKey(id), id).toBe("gpt-6.1-terra");
    expect(tokenPrice("openai/gpt-6.2-sol")?.output).toBe(0.00001);
    expect(tokenPrice("mock-model-id")).toBeNull();
  });

  it("lets a cache win pass the bar and a cache loss fail it, whatever the raw input", () => {
    const luna = tokenPrice("gpt-6-luna")!;
    const run = (
      inputTokens: number,
      cacheReadTokens: number,
    ): ParityReport => ({
      cases: [
        {
          caseId: "owner-a",
          results: [
            {
              status: "PASSED",
              output: {
                score: { stepsPassed: 1 },
                totals: {
                  tokenTurns: 1,
                  inputTokens,
                  inputTokensPerTurn: inputTokens,
                  pricedUsd: pricedUsd(luna, {
                    inputTokens,
                    cacheReadTokens,
                    cacheWriteTokens: 0,
                    outputTokens: 1_000,
                  }),
                },
              },
            },
          ],
        },
      ],
    });
    const baseline = run(100_000, 0);
    // More raw input, nearly all cached: cheaper, passes.
    expect(versionDelta(baseline, run(120_000, 110_000)).meetsBar).toBe(true);
    // Fewer raw tokens, none cached, against a cached baseline: dearer, fails.
    expect(versionDelta(run(100_000, 90_000), run(95_000, 0)).meetsBar).toBe(
      false,
    );
  });
});
