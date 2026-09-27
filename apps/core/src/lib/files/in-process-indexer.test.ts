import { beforeEach, describe, expect, it, vi } from "vitest";

const processFileIndexJobs = vi.fn();
const processFileSuggestionJobs = vi.fn();

vi.mock("@/services/file-index.service", () => ({
  processFileIndexJobs: (input: unknown) => processFileIndexJobs(input),
}));
vi.mock("@/services/file-suggestions.service", () => ({
  processFileSuggestionJobs: (input: unknown) =>
    processFileSuggestionJobs(input),
}));

import { runIndexingNudge } from "./in-process-indexer";

/**
 * The nudge exists because Vercel runs crons on production deployments
 * only, so on a preview nothing else ever leases a Files job.
 *
 * It drained extraction and not suggestion, and the cost of that was not a
 * slower preview. `processFileSuggestionJobs` has exactly one other caller
 * in the repository — the cron — so on every preview the SUGGEST jobs
 * enqueued by extraction accumulated QUEUED and were leased by nothing.
 * Categories and tags, the feature this branch is named for, had therefore
 * never run end to end anywhere, and the empty state they render is
 * indistinguishable from a document that genuinely warranted no labels.
 *
 * These tests are what makes reverting that visible.
 */

const EXTRACTION = { processed: 2, indexed: 2, failed: 0 };
const SUGGESTION = { processed: 1, suggested: 3, failed: 0, deferred: 0 };

beforeEach(() => {
  processFileIndexJobs.mockReset().mockResolvedValue(EXTRACTION);
  processFileSuggestionJobs.mockReset().mockResolvedValue(SUGGESTION);
});

describe("the in-process nudge", () => {
  it("drains suggestion as well as extraction", async () => {
    const result = await runIndexingNudge();

    expect(processFileIndexJobs).toHaveBeenCalledTimes(1);
    expect(processFileSuggestionJobs).toHaveBeenCalledTimes(1);
    expect(result.extraction).toEqual(EXTRACTION);
    expect(result.suggestion).toEqual(SUGGESTION);
  });

  it("extracts before it labels", async () => {
    // A document has to have text before anything can have an opinion
    // about its category, which is also the order the cron uses.
    const order: string[] = [];
    processFileIndexJobs.mockImplementation(async () => {
      order.push("extraction");
      return EXTRACTION;
    });
    processFileSuggestionJobs.mockImplementation(async () => {
      order.push("suggestion");
      return SUGGESTION;
    });

    await runIndexingNudge();

    expect(order).toEqual(["extraction", "suggestion"]);
  });

  it("gives each half its own bounded budget", async () => {
    /**
     * Separate clocks, not one shared clock. Extraction is local work;
     * suggestion is a paid model round trip. Sharing a budget would let a
     * slow extraction consume all of it and leave suggestion exactly as
     * dead as it was before the fix.
     *
     * The suggestion cap is deliberately the smaller of the two: one
     * upload should not work through a backlog on the spend of whoever
     * happened to trigger it.
     */
    await runIndexingNudge();

    const extractionInput = processFileIndexJobs.mock.calls[0][0];
    const suggestionInput = processFileSuggestionJobs.mock.calls[0][0];

    expect(typeof extractionInput.shouldContinue).toBe("function");
    expect(typeof suggestionInput.shouldContinue).toBe("function");
    expect(extractionInput.shouldContinue).not.toBe(
      suggestionInput.shouldContinue,
    );

    expect(suggestionInput.maxJobs).toBeGreaterThan(0);
    expect(suggestionInput.maxJobs).toBeLessThan(extractionInput.maxJobs);

    // Both budgets are live at the moment they are handed over, or the
    // bound would be a bound on nothing.
    expect(extractionInput.shouldContinue()).toBe(true);
    expect(suggestionInput.shouldContinue()).toBe(true);
  });
});

describe("neither half can take down the request that triggered it", () => {
  it("still labels when extraction throws", async () => {
    processFileIndexJobs.mockRejectedValue(new Error("object store down"));

    const result = await runIndexingNudge();

    expect(result.extraction).toEqual({
      processed: 0,
      indexed: 0,
      failed: 0,
    });
    // The important half: a failed extraction must not skip the labelling
    // of documents that were already extracted on an earlier pass.
    expect(processFileSuggestionJobs).toHaveBeenCalledTimes(1);
    expect(result.suggestion).toEqual(SUGGESTION);
  });

  it("still reports extraction when labelling throws", async () => {
    processFileSuggestionJobs.mockRejectedValue(new Error("provider down"));

    const result = await runIndexingNudge();

    // Caught separately, so a provider outage during labelling cannot be
    // read as extraction having done nothing. The two have different
    // answers.
    expect(result.extraction).toEqual(EXTRACTION);
    expect(result.suggestion).toEqual({
      processed: 0,
      suggested: 0,
      failed: 0,
      deferred: 0,
    });
  });

  it("never rejects, whatever both halves do", async () => {
    processFileIndexJobs.mockRejectedValue(new Error("a"));
    processFileSuggestionJobs.mockRejectedValue(new Error("b"));

    // It is handed to `waitUntil`, so an unhandled rejection here is an
    // unhandled rejection in the platform's lifetime extension.
    await expect(runIndexingNudge()).resolves.toBeTruthy();
  });
});
