import { globSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

const processFileIndexJobs = vi.fn();
const processFileSuggestionJobs = vi.fn();
const waitUntil = vi.fn();

vi.mock("@vercel/functions", () => ({
  waitUntil: (promise: Promise<unknown>) => waitUntil(promise),
}));

vi.mock("@/services/file-index.service", () => ({
  processFileIndexJobs: (input: unknown) => processFileIndexJobs(input),
}));
vi.mock("@/services/file-suggestions.service", () => ({
  processFileSuggestionJobs: (input: unknown) =>
    processFileSuggestionJobs(input),
}));

import {
  nudgeFileExtraction,
  nudgeFileIndexing,
  runExtractionNudge,
  runIndexingNudge,
} from "./in-process-indexer";

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
  waitUntil.mockReset();
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

describe("a read path does not buy label evaluations", () => {
  /**
   * `GET /v1/drive/search` nudges too, inside the
   * `isDriveStoreBackfillPending` branch, and it used to call the full
   * nudge. That made a search spend money — up to three paid label
   * evaluations per request, on top of the ranking calls the search makes
   * itself — and backfill stays pending across many visits by design, so
   * it was not a one-off.
   *
   * Worse, it had no completion condition. `backfillDriveStore` returns
   * before writing `backfilledAt` when `BLOB_READ_WRITE_TOKEN` is unset,
   * so the branch stayed live forever and every search kept paying. The
   * other half of that fix is in `file-backfill.postgres.test.ts`.
   */
  it("extracts without labelling", async () => {
    const result = await runExtractionNudge();

    expect(processFileIndexJobs).toHaveBeenCalledTimes(1);
    expect(processFileSuggestionJobs).not.toHaveBeenCalled();
    expect(result).toEqual(EXTRACTION);
  });

  it("is still bounded, and still cannot reject", async () => {
    processFileIndexJobs.mockRejectedValue(new Error("object store down"));

    // Handed to `waitUntil`, so a rejection here is a rejection in the
    // platform's lifetime extension.
    await expect(runExtractionNudge()).resolves.toEqual({
      processed: 0,
      indexed: 0,
      failed: 0,
    });
    expect(processFileSuggestionJobs).not.toHaveBeenCalled();

    const input = processFileIndexJobs.mock.calls[0][0];
    expect(typeof input.shouldContinue).toBe("function");
    expect(input.maxJobs).toBeGreaterThan(0);
  });
});

describe("the exported entry points hand the right work to waitUntil", () => {
  /**
   * The wrappers, not the runners.
   *
   * `search/get.ts` calls `nudgeFileExtraction` and `files/finalize.ts`
   * calls `nudgeFileIndexing`; the runners underneath are what the tests
   * above exercise. Pointing one wrapper at the other runner is a one-word
   * edit that no test above would notice, and it is the edit that puts
   * paid label evaluations back on the read path.
   */
  async function drain() {
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await waitUntil.mock.calls[0][0];
  }

  it("gives the read path extraction and nothing else", async () => {
    nudgeFileExtraction();
    await drain();

    expect(processFileIndexJobs).toHaveBeenCalledTimes(1);
    expect(processFileSuggestionJobs).not.toHaveBeenCalled();
  });

  it("gives the upload path both halves", async () => {
    nudgeFileIndexing();
    await drain();

    expect(processFileIndexJobs).toHaveBeenCalledTimes(1);
    expect(processFileSuggestionJobs).toHaveBeenCalledTimes(1);
  });
});

describe("only write paths may buy label evaluations", () => {
  /**
   * The mutant the two tests above cannot see.
   *
   * Everything else here checks the module's own wiring. Switching the
   * *caller* back — `search/get.ts` importing `nudgeFileIndexing` again —
   * compiles cleanly and turns every test in this file green, which is
   * how the read path came to spend money in the first place. A route
   * test would be the direct check, and none exists for this route;
   * standing one up for one import is out of proportion to the question,
   * which is a one-line invariant: the paid nudge belongs to write paths.
   *
   * So this reads the imports. It is a blunt check and deliberately so —
   * a new read route that reaches for the paid nudge fails here on the
   * day it is written, rather than on a bill.
   */
  const ROUTES = fileURLToPath(new URL("../../routes", import.meta.url));

  /** Routes that create or replace a document, where labelling is the point. */
  const WRITE_PATHS = ["v1/drive/files/finalize.ts"];

  it("is imported by exactly the write paths that declare it", () => {
    const callers = globSync("**/*.ts", { cwd: ROUTES })
      .map((file) => file.replaceAll("\\", "/"))
      .filter((file) => !file.endsWith(".test.ts"))
      .filter((file) =>
        /\bnudgeFileIndexing\b/u.test(
          readFileSync(`${ROUTES}/${file}`, "utf8"),
        ),
      )
      .sort();

    expect(
      callers,
      "a route reaching for the full nudge spends on label evaluations. " +
        "If that route is a write path, add it to WRITE_PATHS with a " +
        "reason. If it is a read path, it wants nudgeFileExtraction.",
    ).toEqual(WRITE_PATHS);
  });

  it("names write paths that exist", () => {
    // An entry that outlives its file would quietly weaken the check above.
    for (const route of WRITE_PATHS) {
      expect(() => readFileSync(`${ROUTES}/${route}`, "utf8")).not.toThrow();
    }
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
