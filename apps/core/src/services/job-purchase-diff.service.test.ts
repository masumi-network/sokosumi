import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  captureExceptionMock,
  getPurchasesDiffMock,
  jobPurchaseFindManyMock,
  syncMetadataDeleteManyMock,
  syncMetadataFindUniqueMock,
  syncMetadataUpsertMock,
} = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
  getPurchasesDiffMock: vi.fn(),
  jobPurchaseFindManyMock: vi.fn(),
  syncMetadataDeleteManyMock: vi.fn(),
  syncMetadataFindUniqueMock: vi.fn(),
  syncMetadataUpsertMock: vi.fn(),
}));

vi.mock("@sentry/node", () => ({
  captureException: captureExceptionMock,
}));

vi.mock("@/clients/masumi-payment.client", () => ({
  paymentClient: () => ({
    getPurchasesDiff: getPurchasesDiffMock,
  }),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    jobPurchase: {
      findMany: jobPurchaseFindManyMock,
    },
    syncMetadata: {
      deleteMany: syncMetadataDeleteManyMock,
      findUnique: syncMetadataFindUniqueMock,
      upsert: syncMetadataUpsertMock,
    },
  },
}));

vi.mock("@sokosumi/database/helpers", () => ({
  mapJobWithStatus: (job: unknown) => job,
}));

import { ok } from "neverthrow";

import {
  PURCHASE_DIFF_INITIAL_LOOKBACK_MS,
  PURCHASE_DIFF_PAGE_SIZE,
  PURCHASE_DIFF_REREAD_WINDOW_MS,
  PURCHASE_DIFF_SYNC_METADATA_KEY,
  type PurchaseDiffSyncOptions,
  syncPurchasesFromDiff,
} from "./job-purchase-diff.service";

type ApplyPurchase = PurchaseDiffSyncOptions["applyPurchase"];

const CHANGED_AT = new Date("2026-01-05T12:00:00.000Z");

function createDiffPurchase(overrides: Record<string, unknown> = {}) {
  return {
    id: "purchase_1",
    blockchainIdentifier: "chain-1",
    nextActionOrOnChainStateOrResultLastChangedAt: CHANGED_AT,
    ...overrides,
  };
}

function createJobPurchaseRow(overrides: Record<string, unknown> = {}) {
  return {
    externalId: "purchase_1",
    job: { id: "job_1", blockchainIdentifier: "chain-1" },
    ...overrides,
  };
}

function createOptions(
  applyPurchase: ApplyPurchase,
  overrides: Partial<PurchaseDiffSyncOptions> = {},
): PurchaseDiffSyncOptions {
  return {
    abortSignal: new AbortController().signal,
    applyPurchase,
    deadlineMs: Date.now() + 60_000,
    shouldContinue: () => true,
    ...overrides,
  };
}

describe("syncPurchasesFromDiff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    syncMetadataFindUniqueMock.mockResolvedValue(null);
    jobPurchaseFindManyMock.mockResolvedValue([]);
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("does not move the cursor when nothing changed", async () => {
    getPurchasesDiffMock.mockResolvedValue(ok([]));
    const applyPurchase = vi.fn<ApplyPurchase>();

    const result = await syncPurchasesFromDiff(createOptions(applyPurchase));

    expect(result).toEqual({ found: 0, processed: 0 });
    expect(applyPurchase).not.toHaveBeenCalled();
    expect(syncMetadataUpsertMock).not.toHaveBeenCalled();
  });

  it("applies a changed purchase to its job and advances the cursor", async () => {
    getPurchasesDiffMock.mockResolvedValueOnce(ok([createDiffPurchase()]));
    jobPurchaseFindManyMock.mockResolvedValue([createJobPurchaseRow()]);
    const applyPurchase = vi.fn<ApplyPurchase>().mockResolvedValue(undefined);

    const result = await syncPurchasesFromDiff(createOptions(applyPurchase));

    expect(applyPurchase).toHaveBeenCalledTimes(1);
    expect(applyPurchase.mock.calls[0][0]).toMatchObject({ id: "job_1" });
    expect(applyPurchase.mock.calls[0][1]).toMatchObject({ id: "purchase_1" });
    expect(result).toEqual({ found: 1, processed: 1 });
    // The id join is the whole mechanism: without this the service could query
    // on any column and every test would still pass.
    expect(jobPurchaseFindManyMock).toHaveBeenCalledWith({
      where: { externalId: { in: ["purchase_1"] } },
      include: { job: { include: expect.anything() } },
    });
    expect(syncMetadataUpsertMock).toHaveBeenCalledWith({
      where: { key: PURCHASE_DIFF_SYNC_METADATA_KEY },
      create: {
        key: PURCHASE_DIFF_SYNC_METADATA_KEY,
        cursorId: "purchase_1",
        lastSyncedAt: CHANGED_AT,
      },
      update: { cursorId: "purchase_1", lastSyncedAt: CHANGED_AT },
    });
  });

  it("matches a row by blockchain identifier when the stored id is stale", async () => {
    getPurchasesDiffMock.mockResolvedValueOnce(
      ok([createDiffPurchase({ id: "purchase_new" })]),
    );
    jobPurchaseFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        createJobPurchaseRow({ externalId: "purchase_old" }),
      ]);
    const applyPurchase = vi.fn<ApplyPurchase>().mockResolvedValue(undefined);

    const result = await syncPurchasesFromDiff(createOptions(applyPurchase));

    expect(jobPurchaseFindManyMock).toHaveBeenNthCalledWith(2, {
      where: { job: { blockchainIdentifier: { in: ["chain-1"] } } },
      include: { job: { include: expect.anything() } },
    });
    expect(applyPurchase).toHaveBeenCalledTimes(1);
    expect(applyPurchase.mock.calls[0][0]).toMatchObject({ id: "job_1" });
    expect(result.processed).toBe(1);
  });

  it("starts from a bounded lookback when no cursor is stored", async () => {
    syncMetadataFindUniqueMock.mockResolvedValue(null);
    getPurchasesDiffMock.mockResolvedValueOnce(ok([]));
    const startedAt = Date.now();

    await syncPurchasesFromDiff(createOptions(vi.fn<ApplyPurchase>()));

    const [changedAt, cursorId] = getPurchasesDiffMock.mock.calls[0];
    expect(cursorId).toBeNull();
    expect(changedAt.getTime()).toBeGreaterThanOrEqual(
      startedAt - PURCHASE_DIFF_INITIAL_LOOKBACK_MS,
    );
    expect(changedAt.getTime()).toBeLessThan(
      Date.now() - PURCHASE_DIFF_INITIAL_LOOKBACK_MS + 60_000,
    );
  });

  it("re-reads a window before the stored cursor", async () => {
    syncMetadataFindUniqueMock.mockResolvedValue({
      cursorId: "purchase_0",
      lastSyncedAt: CHANGED_AT,
    });
    getPurchasesDiffMock.mockResolvedValueOnce(ok([]));

    await syncPurchasesFromDiff(createOptions(vi.fn<ApplyPurchase>()));

    // A change stamped before the cursor but committed after it was persisted
    // is only ever served again inside this window.
    expect(getPurchasesDiffMock).toHaveBeenCalledWith(
      new Date(CHANGED_AT.getTime() - PURCHASE_DIFF_REREAD_WINDOW_MS),
      null,
      PURCHASE_DIFF_PAGE_SIZE,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("skips a diff row that belongs to no local job but still advances", async () => {
    getPurchasesDiffMock.mockResolvedValueOnce(ok([createDiffPurchase()]));
    jobPurchaseFindManyMock.mockResolvedValue([]);
    const applyPurchase = vi.fn<ApplyPurchase>();

    const result = await syncPurchasesFromDiff(createOptions(applyPurchase));

    expect(applyPurchase).not.toHaveBeenCalled();
    expect(result.processed).toBe(0);
    expect(syncMetadataUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { cursorId: "purchase_1", lastSyncedAt: CHANGED_AT },
      }),
    );
  });

  it("refuses a row whose blockchain identifier does not match the job", async () => {
    getPurchasesDiffMock.mockResolvedValueOnce(ok([createDiffPurchase()]));
    jobPurchaseFindManyMock.mockResolvedValue([
      createJobPurchaseRow({
        job: { id: "job_1", blockchainIdentifier: "chain-other" },
      }),
    ]);
    const applyPurchase = vi.fn<ApplyPurchase>();

    await syncPurchasesFromDiff(createOptions(applyPurchase));

    expect(applyPurchase).not.toHaveBeenCalled();
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(syncMetadataUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { cursorId: "purchase_1", lastSyncedAt: CHANGED_AT },
      }),
    );
  });

  it("parks the cursor on the last applied row when one fails", async () => {
    getPurchasesDiffMock.mockResolvedValueOnce(
      ok([
        createDiffPurchase(),
        createDiffPurchase({
          id: "purchase_2",
          blockchainIdentifier: "chain-2",
        }),
        createDiffPurchase({
          id: "purchase_3",
          blockchainIdentifier: "chain-3",
        }),
      ]),
    );
    jobPurchaseFindManyMock.mockResolvedValue([
      createJobPurchaseRow(),
      createJobPurchaseRow({
        externalId: "purchase_2",
        job: { id: "job_2", blockchainIdentifier: "chain-2" },
      }),
      createJobPurchaseRow({
        externalId: "purchase_3",
        job: { id: "job_3", blockchainIdentifier: "chain-3" },
      }),
    ]);
    const applyPurchase = vi
      .fn<ApplyPurchase>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("write failed"));

    const result = await syncPurchasesFromDiff(createOptions(applyPurchase));

    expect(applyPurchase).toHaveBeenCalledTimes(2);
    expect(result.processed).toBe(1);
    expect(syncMetadataUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { cursorId: "purchase_1", lastSyncedAt: CHANGED_AT },
      }),
    );
  });

  it("keeps the cursor untouched when the node rejects the request", async () => {
    const { err } = await import("neverthrow");
    getPurchasesDiffMock.mockResolvedValueOnce(err("purchase-diff 500"));

    const result = await syncPurchasesFromDiff(
      createOptions(vi.fn<ApplyPurchase>()),
    );

    expect(result).toEqual({ found: 0, processed: 0 });
    expect(syncMetadataUpsertMock).not.toHaveBeenCalled();
    // The diff is the only path that updates an attached purchase, so a
    // failing request has to page rather than look like a quiet tick.
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it("replays from the beginning when the cursor is reset", async () => {
    syncMetadataFindUniqueMock.mockResolvedValue({
      cursorId: "purchase_0",
      lastSyncedAt: CHANGED_AT,
    });
    getPurchasesDiffMock.mockResolvedValueOnce(ok([]));

    await syncPurchasesFromDiff(
      createOptions(vi.fn<ApplyPurchase>(), { resetCursor: true }),
    );

    expect(syncMetadataDeleteManyMock).toHaveBeenCalledWith({
      where: { key: PURCHASE_DIFF_SYNC_METADATA_KEY },
    });
    expect(getPurchasesDiffMock).toHaveBeenCalledWith(
      new Date(0),
      null,
      PURCHASE_DIFF_PAGE_SIZE,
      expect.anything(),
    );
  });

  it("pages until the node returns a short page", async () => {
    const fullPage = Array.from({ length: PURCHASE_DIFF_PAGE_SIZE }, (_, i) =>
      createDiffPurchase({ id: `purchase_${i}` }),
    );
    getPurchasesDiffMock
      .mockResolvedValueOnce(ok(fullPage))
      .mockResolvedValueOnce(ok([createDiffPurchase({ id: "purchase_last" })]));

    const result = await syncPurchasesFromDiff(
      createOptions(vi.fn<ApplyPurchase>()),
    );

    expect(getPurchasesDiffMock).toHaveBeenCalledTimes(2);
    expect(getPurchasesDiffMock.mock.calls[1][0]).toEqual(CHANGED_AT);
    expect(getPurchasesDiffMock.mock.calls[1][1]).toBe(
      `purchase_${PURCHASE_DIFF_PAGE_SIZE - 1}`,
    );
    expect(result.found).toBe(PURCHASE_DIFF_PAGE_SIZE + 1);
  });
});

describe("syncPurchasesFromDiff budget handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    syncMetadataFindUniqueMock.mockResolvedValue(null);
    jobPurchaseFindManyMock.mockResolvedValue([]);
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  it("makes no request once the run is aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await syncPurchasesFromDiff(
      createOptions(vi.fn<ApplyPurchase>(), {
        abortSignal: controller.signal,
      }),
    );

    expect(getPurchasesDiffMock).not.toHaveBeenCalled();
    expect(result).toEqual({ found: 0, processed: 0 });
  });

  it("stops mid-page when the run budget runs out", async () => {
    getPurchasesDiffMock.mockResolvedValueOnce(
      ok([
        createDiffPurchase(),
        createDiffPurchase({
          id: "purchase_2",
          blockchainIdentifier: "chain-2",
        }),
      ]),
    );
    jobPurchaseFindManyMock.mockResolvedValue([
      createJobPurchaseRow(),
      createJobPurchaseRow({
        externalId: "purchase_2",
        job: { id: "job_2", blockchainIdentifier: "chain-2" },
      }),
    ]);
    // One check before the request, then one per row: the second row is the
    // one that must fall outside the budget.
    let checksLeft = 2;
    const applyPurchase = vi.fn<ApplyPurchase>().mockResolvedValue(undefined);

    const result = await syncPurchasesFromDiff(
      createOptions(applyPurchase, {
        shouldContinue: () => checksLeft-- > 0,
      }),
    );

    expect(applyPurchase).toHaveBeenCalledTimes(1);
    expect(result.processed).toBe(1);
    expect(syncMetadataUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { cursorId: "purchase_1", lastSyncedAt: CHANGED_AT },
      }),
    );
  });
});

describe("syncPurchasesFromDiff cursor stalls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jobPurchaseFindManyMock.mockResolvedValue([]);
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("stops when a page ends where the previous page ended", async () => {
    syncMetadataFindUniqueMock.mockResolvedValue(null);
    const fullPage = Array.from({ length: PURCHASE_DIFF_PAGE_SIZE }, (_, i) =>
      createDiffPurchase({ id: `purchase_${i}` }),
    );
    // A node that treats its cursor as inclusive would serve this page for
    // ever; the run must stop instead of re-applying it until the deadline.
    getPurchasesDiffMock.mockResolvedValue(ok(fullPage));

    const result = await syncPurchasesFromDiff(
      createOptions(vi.fn<ApplyPurchase>()),
    );

    expect(getPurchasesDiffMock).toHaveBeenCalledTimes(2);
    expect(result.found).toBe(PURCHASE_DIFF_PAGE_SIZE * 2);
  });
});
