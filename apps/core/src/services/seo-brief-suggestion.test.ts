import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectCoreLog } from "@/test/core-log";
import { suggestSeoPageAction } from "./seo-brief-suggestion";

const { evaluator } = vi.hoisted(() => ({ evaluator: vi.fn() }));
vi.mock("ai", () => ({
  experimental_evaluate: evaluator,
  gateway: { evaluationModel: vi.fn() },
}));

describe("first audit page action", () => {
  beforeEach(() => {
    evaluator.mockReset();
  });
  it("sends only the public route cue and shares a pending read across unrelated URLs with that cue", async () => {
    evaluator.mockResolvedValueOnce({
      answers: { action: { choice: "buy", probabilities: { buy: 0.98 } } },
    });
    const urls = [
      "https://secret-one.test/en/pricing/owner-name?secret=unpublished#private",
      "https://secret-two.test/pricing/different-owner",
    ];
    expect(await Promise.all(urls.map(suggestSeoPageAction))).toEqual([
      "buy",
      "buy",
    ]);
    expect(evaluator).toHaveBeenCalledTimes(1);
    expect(evaluator.mock.calls[0]?.[0].state).toBe("pricing");
  });

  it("keeps ambiguous homepages, private path suffixes and query parameter guesses out of the model", async () => {
    for (const url of [
      "https://shop.test/?action=buy",
      "https://shop.test/de",
      "https://shop.test/account/name/pricing",
      "https://shop.test/some-order-number?read",
    ])
      expect(await suggestSeoPageAction(url)).toBeNull();
    expect(evaluator).not.toHaveBeenCalled();
  });

  it("leaves the decision manual when the provider fails or returns an uncertain choice", async () => {
    expectCoreLog("warn", "The SEO setup suggestion was unavailable.");
    evaluator.mockRejectedValueOnce(new Error("provider timeout"));
    expect(
      await suggestSeoPageAction("https://example.test/docs/getting-started"),
    ).toBeNull();
    evaluator.mockResolvedValueOnce({
      answers: {
        action: { choice: "read", probabilities: { read: 0.51, unsure: 0.49 } },
      },
    });
    expect(await suggestSeoPageAction("https://example.test/help")).toBeNull();
  });
  it("requires a probability reported by the judge before suggesting an action", async () => {
    evaluator.mockResolvedValueOnce({
      answers: { action: { choice: "subscribe" } },
    });
    expect(
      await suggestSeoPageAction("https://example.test/newsletter"),
    ).toBeNull();
  });
});
