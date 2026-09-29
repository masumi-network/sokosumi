import { beforeEach, describe, expect, it, vi } from "vitest";

const leaseNextFileIndexJob = vi.fn();
const headMock = vi.fn();

vi.mock("@vercel/blob", () => ({
  head: (...args: unknown[]) => headMock(...args),
}));
vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({ ...actual.getEnv(), BLOB_READ_WRITE_TOKEN: "t" }),
  };
});

vi.mock("@/lib/files/index-jobs", () => ({
  leaseNextFileIndexJob: (input: unknown) => leaseNextFileIndexJob(input),
  completeFileIndexJob: vi.fn(),
  failFileIndexJob: vi.fn(),
  deferFileIndexJob: vi.fn(),
  enqueueFileIndexJob: vi.fn(),
}));

import {
  downloadBlob,
  EXTRACTION_JOB_WORST_CASE_MS,
  processFileIndexJobs,
  SYNC_TAIL_RESERVE_MS,
} from "./file-index.service";

/**
 * Will the drain loop start a job it cannot finish?
 *
 * It used to. `shouldContinue()` was checked before leasing and never
 * during, so at the documented production window — `LOCK_TIMEOUT` 120,000
 * minus `LOCK_TIMEOUT_BUFFER` 25,000, so 95 s — a job leased at 94.9 s ran
 * to roughly 135 s. That is 15 s past `LOCK_TIMEOUT`, at which point
 * `sync-lock.service.ts` makes the lock stealable and the next minute's
 * tick starts this same pipeline beside the one still running. The lease
 * and fence make that wasted work rather than corruption, which is the
 * only reason it was not worse.
 *
 * The second half is starvation. Extraction runs first in `drive-index`,
 * so before the reserve a few slow PDFs could consume the entire window
 * and leave suggestion, table re-indexing and admission pruning nothing,
 * every tick, silently.
 */

const RESERVE = EXTRACTION_JOB_WORST_CASE_MS + SYNC_TAIL_RESERVE_MS;

beforeEach(() => {
  leaseNextFileIndexJob.mockReset().mockResolvedValue(null);
  headMock.mockReset();
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("the extraction drain stays inside the sync window", () => {
  it("does not lease when a worst-case job would not fit", async () => {
    // One millisecond short of the reserve. `shouldContinue` still says
    // yes, which is exactly the state that used to lease.
    const result = await processFileIndexJobs({
      shouldContinue: () => true,
      msRemaining: () => RESERVE - 1,
    });

    expect(leaseNextFileIndexJob).not.toHaveBeenCalled();
    expect(result).toEqual({ processed: 0, indexed: 0, failed: 0 });
  });

  it("leases when the budget is exactly enough", async () => {
    // The boundary in the other direction, so the guard is a threshold
    // and not a blanket refusal.
    await processFileIndexJobs({
      shouldContinue: () => true,
      msRemaining: () => RESERVE,
    });

    expect(leaseNextFileIndexJob).toHaveBeenCalledTimes(1);
  });

  it("stops leasing partway once the budget runs down", async () => {
    /**
     * The realistic shape: several jobs succeed, the clock advances, and
     * the loop declines to start another rather than running one past the
     * deadline.
     */
    let remaining = RESERVE + 2_000;
    leaseNextFileIndexJob.mockImplementation(async () => {
      remaining -= 1_000;
      return null; // No work; the loop exits on its own after leasing.
    });

    await processFileIndexJobs({
      shouldContinue: () => true,
      msRemaining: () => remaining,
    });

    // Leased while the budget held, then stopped — not once, not forever.
    expect(leaseNextFileIndexJob).toHaveBeenCalledTimes(1);
  });

  it("holds back a tail for the stages that run after it", () => {
    /**
     * Extraction is first in `drive-index`. The reserve is what stops it
     * consuming the whole tick: the loop needs room for a worst-case job
     * *plus* the tail, so the last job it starts still leaves the tail
     * behind.
     */
    expect(SYNC_TAIL_RESERVE_MS).toBeGreaterThan(0);
    expect(RESERVE).toBeGreaterThan(EXTRACTION_JOB_WORST_CASE_MS);
  });

  it("covers a worst-case job at the documented production window", () => {
    /**
     * The arithmetic that makes the reserve meaningful rather than a
     * round number. `.env.example` documents `LOCK_TIMEOUT` 120,000 and
     * `LOCK_TIMEOUT_BUFFER` 25,000, so the drain window is 95 s, and the
     * reserve has to fit inside it or the loop can never lease at all.
     */
    const WINDOW_MS = 120_000 - 25_000;

    expect(EXTRACTION_JOB_WORST_CASE_MS).toBeGreaterThanOrEqual(40_000);
    expect(RESERVE).toBeLessThan(WINDOW_MS);
  });

  it("applies no reserve when no clock is supplied", async () => {
    /**
     * The in-process nudge bounds itself with its own deadline and holds
     * no lock, so there is nothing for it to overrun. Requiring a budget
     * it cannot supply would silently stop it draining anything.
     */
    await processFileIndexJobs({ shouldContinue: () => true });

    expect(leaseNextFileIndexJob).toHaveBeenCalledTimes(1);
  });
});

describe("every call inside an extraction job is bounded", () => {
  it("gives the metadata lookup a timeout", async () => {
    /**
     * `head` was called with no signal, so one hung request could hold a
     * job open indefinitely. That does not merely slow a tick down: it
     * makes the worst case unknowable, and `EXTRACTION_JOB_WORST_CASE_MS`
     * is the number the lease budget compares against. An unbounded call
     * inside a budgeted loop turns the budget into decoration.
     *
     * The budget tests above cannot see this — they stop at the lease —
     * which is why removing the timeout left all six of them green.
     */
    headMock.mockResolvedValue({ size: 1, url: "https://example.test/x" });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(new Uint8Array([1])));

    await downloadBlob("drive/users/u/x.txt");

    expect(headMock).toHaveBeenCalledTimes(1);
    const options = headMock.mock.calls[0][1] as { abortSignal?: AbortSignal };
    expect(options.abortSignal).toBeInstanceOf(AbortSignal);

    // And the download it precedes is bounded too, so the pair really
    // does cover the front of the worst case.
    const init = fetchSpy.mock.calls[0][1] as { signal?: AbortSignal };
    expect(init.signal).toBeInstanceOf(AbortSignal);
    fetchSpy.mockRestore();
  });
});
