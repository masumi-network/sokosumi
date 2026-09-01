import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  captureExceptionMock,
  getPurchasesDiffMock,
  jobPurchaseFindManyMock,
  syncMetadataFindUniqueMock,
  syncMetadataUpdateManyMock,
  syncMetadataUpsertMock,
} = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
  getPurchasesDiffMock: vi.fn(),
  jobPurchaseFindManyMock: vi.fn(),
  syncMetadataFindUniqueMock: vi.fn(),
  syncMetadataUpdateManyMock: vi.fn(),
  syncMetadataUpsertMock: vi.fn(),
}));

vi.mock("@sentry/node", () => ({
  captureException: captureExceptionMock,
  withScope: (callback: (scope: { setExtras: () => void }) => void) =>
    callback({ setExtras: () => {} }),
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
      findUnique: syncMetadataFindUniqueMock,
      updateMany: syncMetadataUpdateManyMock,
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
const STORED_STABLE_THROUGH = new Date("2026-01-05T13:00:00.000Z");

function createStoredCursor(
  cursorId: string,
  changedAt = CHANGED_AT,
  stableThrough = STORED_STABLE_THROUGH,
) {
  return {
    cursorId: JSON.stringify({
      changedAt: changedAt.toISOString(),
      cursorId,
      stableThrough: stableThrough.toISOString(),
      version: 1,
    }),
    lastSyncedAt: new Date(
      changedAt.getTime() - PURCHASE_DIFF_REREAD_WINDOW_MS,
    ),
  };
}

function storedCursorContaining(cursorId: string) {
  return expect.stringContaining(`"cursorId":"${cursorId}"`);
}

function createDiffPurchase(overrides: Record<string, unknown> = {}) {
  return {
    id: "purchase_1",
    blockchainIdentifier: "chain-1",
    inputHash: "INPUT-HASH-1",
    agentIdentifier: "agent-chain-1",
    payByTime: "1767616200000",
    submitResultTime: "1767616800000",
    unlockTime: "1767617400000",
    externalDisputeUnlockTime: "1767618000000",
    PaidFunds: [{ unit: "lovelace", amount: "1000000" }],
    PaymentSource: { paymentSourceType: "Web3CardanoV1" },
    SellerWallet: { walletVkey: "seller-vkey-1" },
    metadata: JSON.stringify({
      inputData: { prompt: "hello" },
      jobId: "agent-job-1",
    }),
    nextActionOrOnChainStateOrResultLastChangedAt: CHANGED_AT,
    ...overrides,
  };
}

function createJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job_1",
    blockchainIdentifier: "chain-1",
    inputHash: "input-hash-1",
    agentBlockchainIdentifier: "agent-chain-1",
    agentJobId: "agent-job-1",
    input: JSON.stringify({ prompt: "hello" }),
    payByTime: new Date(1767616200000),
    submitResultTime: new Date(1767616800000),
    unlockTime: new Date(1767617400000),
    externalDisputeUnlockTime: new Date(1767618000000),
    purchaseAmounts: [{ unit: "lovelace", amount: "1000000" }],
    purchaseAmountMatchRequired: true,
    paymentSourceType: "Web3CardanoV1",
    sellerVkey: "seller-vkey-1",
    ...overrides,
  };
}

function createJobPurchaseRow(overrides: Record<string, unknown> = {}) {
  return {
    externalId: "purchase_1",
    job: createJob(),
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

  it("anchors the initial cursor when nothing changed", async () => {
    getPurchasesDiffMock.mockResolvedValue(ok([]));
    const applyPurchase = vi.fn<ApplyPurchase>();
    const earliestStart = Date.now() - PURCHASE_DIFF_INITIAL_LOOKBACK_MS;

    const result = await syncPurchasesFromDiff(createOptions(applyPurchase));
    const latestStart = Date.now() - PURCHASE_DIFF_INITIAL_LOOKBACK_MS;

    expect(result).toEqual({ found: 0, processed: 0 });
    expect(applyPurchase).not.toHaveBeenCalled();
    expect(syncMetadataUpsertMock).toHaveBeenCalledTimes(1);
    const initialCheckpoint = syncMetadataUpsertMock.mock.calls[0]?.[0];
    expect(initialCheckpoint).toMatchObject({
      where: { key: PURCHASE_DIFF_SYNC_METADATA_KEY },
      create: {
        key: PURCHASE_DIFF_SYNC_METADATA_KEY,
        cursorId: null,
      },
      update: expect.anything(),
    });
    const initialStart = initialCheckpoint?.create.lastSyncedAt as Date;
    expect(initialStart.getTime()).toBeGreaterThanOrEqual(earliestStart);
    expect(initialStart.getTime()).toBeLessThanOrEqual(latestStart);
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
    expect(syncMetadataUpsertMock).toHaveBeenLastCalledWith({
      where: { key: PURCHASE_DIFF_SYNC_METADATA_KEY },
      create: {
        key: PURCHASE_DIFF_SYNC_METADATA_KEY,
        cursorId: storedCursorContaining("purchase_1"),
        lastSyncedAt: expect.any(Date),
      },
      update: {
        cursorId: storedCursorContaining("purchase_1"),
        lastSyncedAt: expect.any(Date),
      },
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
      where: {
        job: {
          blockchainIdentifier: {
            in: ["chain-1"],
            mode: "insensitive",
          },
        },
      },
      include: { job: { include: expect.anything() } },
    });
    expect(applyPurchase).toHaveBeenCalledTimes(1);
    expect(applyPurchase.mock.calls[0][0]).toMatchObject({ id: "job_1" });
    expect(result.processed).toBe(1);
  });

  it("matches a stale-id fallback when hex identifier casing differs", async () => {
    getPurchasesDiffMock.mockResolvedValueOnce(
      ok([
        createDiffPurchase({
          id: "purchase_new",
          blockchainIdentifier: "CHAIN-1",
        }),
      ]),
    );
    jobPurchaseFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        createJobPurchaseRow({ externalId: "purchase_old" }),
      ]);
    const applyPurchase = vi.fn<ApplyPurchase>().mockResolvedValue(undefined);

    const result = await syncPurchasesFromDiff(createOptions(applyPurchase));

    expect(jobPurchaseFindManyMock).toHaveBeenNthCalledWith(2, {
      where: {
        job: {
          blockchainIdentifier: {
            in: ["CHAIN-1"],
            mode: "insensitive",
          },
        },
      },
      include: { job: { include: expect.anything() } },
    });
    expect(applyPurchase).toHaveBeenCalledTimes(1);
    expect(result.processed).toBe(1);
  });

  it("refuses a fallback match whose terms are not the job's terms", async () => {
    getPurchasesDiffMock.mockResolvedValueOnce(
      ok([
        createDiffPurchase({ id: "purchase_new", inputHash: "other-input" }),
      ]),
    );
    jobPurchaseFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        createJobPurchaseRow({ externalId: "purchase_old" }),
      ]);
    const applyPurchase = vi.fn<ApplyPurchase>().mockResolvedValue(undefined);

    const result = await syncPurchasesFromDiff(createOptions(applyPurchase));

    // Sharing a blockchain identifier is what the 409 duplicate guard refuses
    // at hire time; the fallback must not be a way around it.
    expect(applyPurchase).not.toHaveBeenCalled();
    expect(result.processed).toBe(0);
  });

  it("refuses a fallback match with a different seller", async () => {
    getPurchasesDiffMock.mockResolvedValueOnce(
      ok([
        createDiffPurchase({
          id: "purchase_new",
          SellerWallet: { walletVkey: "seller-vkey-other" },
        }),
      ]),
    );
    jobPurchaseFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        createJobPurchaseRow({ externalId: "purchase_old" }),
      ]);
    const applyPurchase = vi.fn<ApplyPurchase>().mockResolvedValue(undefined);

    const result = await syncPurchasesFromDiff(createOptions(applyPurchase));

    expect(applyPurchase).not.toHaveBeenCalled();
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(result.processed).toBe(0);
  });

  it("refuses ambiguous case-insensitive fallback matches", async () => {
    getPurchasesDiffMock.mockResolvedValueOnce(
      ok([createDiffPurchase({ id: "purchase_new" })]),
    );
    jobPurchaseFindManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([
      createJobPurchaseRow({ externalId: "purchase_old_1" }),
      createJobPurchaseRow({
        externalId: "purchase_old_2",
        job: createJob({ id: "job_2", blockchainIdentifier: "CHAIN-1" }),
      }),
    ]);
    const applyPurchase = vi.fn<ApplyPurchase>().mockResolvedValue(undefined);

    const result = await syncPurchasesFromDiff(createOptions(applyPurchase));

    expect(applyPurchase).not.toHaveBeenCalled();
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(result.processed).toBe(0);
  });

  it("gives a job at most one row per page", async () => {
    getPurchasesDiffMock.mockResolvedValueOnce(
      ok([createDiffPurchase(), createDiffPurchase({ id: "purchase_new" })]),
    );
    jobPurchaseFindManyMock
      .mockResolvedValueOnce([createJobPurchaseRow()])
      .mockResolvedValueOnce([createJobPurchaseRow()]);
    const applyPurchase = vi.fn<ApplyPurchase>().mockResolvedValue(undefined);

    await syncPurchasesFromDiff(createOptions(applyPurchase));

    // Otherwise the job's status flips between the two rows on every run of
    // the re-read window, re-firing its emails and webhook each time.
    expect(applyPurchase).toHaveBeenCalledTimes(1);
  });

  it("gives a job at most one fallback row across pages", async () => {
    // A full first page, so the run reads a second one. Every row on it
    // matches by id, which is the ordinary case: the fallback query never
    // runs for this page, and the claims still have to be recorded.
    const firstPage = Array.from(
      { length: PURCHASE_DIFF_PAGE_SIZE },
      (_row, index) =>
        index === 0
          ? createDiffPurchase()
          : createDiffPurchase({
              id: `purchase_other_${index}`,
              blockchainIdentifier: `chain-other-${index}`,
            }),
    );
    getPurchasesDiffMock
      .mockResolvedValueOnce(ok(firstPage))
      // Same job, same terms, different purchase id: a stale row the id join
      // cannot see, on a page of its own.
      .mockResolvedValueOnce(ok([createDiffPurchase({ id: "purchase_new" })]));
    jobPurchaseFindManyMock
      .mockResolvedValueOnce(
        firstPage.map((purchase, index) =>
          index === 0
            ? createJobPurchaseRow()
            : createJobPurchaseRow({
                externalId: purchase.id,
                job: createJob({
                  id: `job_other_${index}`,
                  blockchainIdentifier: purchase.blockchainIdentifier,
                }),
              }),
        ),
      )
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        createJobPurchaseRow({ externalId: "purchase_old" }),
      ]);
    const applyPurchase = vi.fn<ApplyPurchase>().mockResolvedValue(undefined);

    await syncPurchasesFromDiff(createOptions(applyPurchase));

    // Two rows applying to one job would flip its status between them on
    // every run of the re-read window, re-firing its emails and webhook.
    const appliedToFirstJob = applyPurchase.mock.calls.filter(
      ([job]) => job.id === "job_1",
    );
    expect(appliedToFirstJob).toHaveLength(1);
    expect(appliedToFirstJob[0][1].id).toBe("purchase_1");
  });

  it("refuses a fallback match ordered from a different agent", async () => {
    getPurchasesDiffMock.mockResolvedValueOnce(
      ok([
        createDiffPurchase({
          id: "purchase_new",
          agentIdentifier: "agent-chain-other",
        }),
      ]),
    );
    jobPurchaseFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        createJobPurchaseRow({ externalId: "purchase_old" }),
      ]);
    const applyPurchase = vi.fn<ApplyPurchase>().mockResolvedValue(undefined);

    const result = await syncPurchasesFromDiff(createOptions(applyPurchase));

    // The agent identifier is who the work was ordered from. A row that
    // names a different seller is not this job's purchase.
    expect(applyPurchase).not.toHaveBeenCalled();
    expect(result.processed).toBe(0);
  });

  it("refuses a fallback match when the job records no agent identifier", async () => {
    getPurchasesDiffMock.mockResolvedValueOnce(
      ok([createDiffPurchase({ id: "purchase_new" })]),
    );
    jobPurchaseFindManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([
      createJobPurchaseRow({
        externalId: "purchase_old",
        job: createJob({ agentBlockchainIdentifier: null, agent: null }),
      }),
    ]);
    const applyPurchase = vi.fn<ApplyPurchase>().mockResolvedValue(undefined);

    const result = await syncPurchasesFromDiff(createOptions(applyPurchase));

    // Nothing to compare the row against, so the match cannot be verified.
    expect(applyPurchase).not.toHaveBeenCalled();
    expect(result.processed).toBe(0);
  });

  it("resumes on the stored row when the previous run stopped early", async () => {
    syncMetadataFindUniqueMock.mockResolvedValue(
      createStoredCursor("purchase_0"),
    );
    getPurchasesDiffMock.mockResolvedValueOnce(ok([]));

    await syncPurchasesFromDiff(createOptions(vi.fn<ApplyPurchase>()));

    // Not the re-read window: a run that cannot drain that window in one
    // budget would otherwise repeat it forever and never reach what is newer.
    expect(getPurchasesDiffMock).toHaveBeenCalledWith(
      CHANGED_AT,
      "purchase_0",
      PURCHASE_DIFF_PAGE_SIZE,
      expect.anything(),
    );
  });

  it("clears the resume point once the feed is drained", async () => {
    syncMetadataFindUniqueMock.mockResolvedValue(
      createStoredCursor("purchase_0"),
    );
    getPurchasesDiffMock.mockResolvedValueOnce(ok([]));

    await syncPurchasesFromDiff(createOptions(vi.fn<ApplyPurchase>()));

    // Arms the re-read window for the next run.
    expect(syncMetadataUpdateManyMock).toHaveBeenCalledWith({
      where: { key: PURCHASE_DIFF_SYNC_METADATA_KEY },
      data: { cursorId: null, lastSyncedAt: STORED_STABLE_THROUGH },
    });
  });

  it("keeps the resume point when the run stops before the feed ends", async () => {
    // A full page, so the run is out of budget rather than out of feed.
    const page = Array.from(
      { length: PURCHASE_DIFF_PAGE_SIZE },
      (_row, index) => createDiffPurchase({ id: `purchase_page_${index}` }),
    );
    getPurchasesDiffMock.mockResolvedValueOnce(ok(page));
    // One cursor check, one request, then every row on it. The next request
    // falls outside the budget.
    let checksLeft = 2 + PURCHASE_DIFF_PAGE_SIZE;

    await syncPurchasesFromDiff(
      createOptions(vi.fn<ApplyPurchase>(), {
        shouldContinue: () => checksLeft-- > 0,
      }),
    );

    expect(syncMetadataUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {
          cursorId: storedCursorContaining(
            `purchase_page_${PURCHASE_DIFF_PAGE_SIZE - 1}`,
          ),
          lastSyncedAt: expect.any(Date),
        },
      }),
    );
    // Not drained: the next run resumes here instead of re-reading the window.
    expect(syncMetadataUpdateManyMock).not.toHaveBeenCalled();
  });

  it("clamps the request timeout to what is left of the run budget", async () => {
    getPurchasesDiffMock.mockResolvedValue(ok([]));
    const timeoutSignal = new AbortController().signal;
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValueOnce(timeoutSignal);

    try {
      await syncPurchasesFromDiff(
        createOptions(vi.fn<ApplyPurchase>(), { deadlineMs: Date.now() + 350 }),
      );

      // Without the clamp this request could outlive the run by 10s and eat the
      // budget the refund phase is reserved.
      const requestedTimeout = timeoutSpy.mock.calls[0][0];
      expect(requestedTimeout).toBeGreaterThan(0);
      expect(requestedTimeout).toBeLessThanOrEqual(100);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it("makes no request when the remaining budget is only the buffer", async () => {
    await syncPurchasesFromDiff(
      createOptions(vi.fn<ApplyPurchase>(), { deadlineMs: Date.now() + 100 }),
    );

    expect(getPurchasesDiffMock).not.toHaveBeenCalled();
  });

  it("keeps the documented tuning constants", () => {
    // Both carry a written justification: 30 days mirrors the offline-agent
    // sync window, 5 minutes is the commit-visibility window.
    expect(PURCHASE_DIFF_INITIAL_LOOKBACK_MS).toBe(1000 * 60 * 60 * 24 * 30);
    expect(PURCHASE_DIFF_REREAD_WINDOW_MS).toBe(1000 * 60 * 5);
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

  it("skips the stored resume row before spending the row budget", async () => {
    syncMetadataFindUniqueMock.mockResolvedValue(
      createStoredCursor("purchase_1"),
    );
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
        job: createJob({ id: "job_2", blockchainIdentifier: "chain-2" }),
      }),
    ]);
    // The cursor check, request, and one new row fit. The inclusive resume row
    // was already handled and must not consume this run's row budget.
    let checksLeft = 3;
    const applyPurchase = vi.fn<ApplyPurchase>().mockResolvedValue(undefined);

    await syncPurchasesFromDiff(
      createOptions(applyPurchase, {
        shouldContinue: () => checksLeft-- > 0,
      }),
    );

    expect(jobPurchaseFindManyMock).toHaveBeenNthCalledWith(1, {
      where: { externalId: { in: ["purchase_2"] } },
      include: { job: { include: expect.anything() } },
    });
    expect(applyPurchase).toHaveBeenCalledTimes(1);
    expect(applyPurchase.mock.calls[0][1]).toMatchObject({ id: "purchase_2" });
    expect(syncMetadataUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {
          cursorId: storedCursorContaining("purchase_2"),
          lastSyncedAt: expect.any(Date),
        },
      }),
    );
  });

  it("re-reads a window before the stored cursor", async () => {
    syncMetadataFindUniqueMock.mockResolvedValue({
      cursorId: null,
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

  it("keeps late commits visible after two interrupted backlog runs", async () => {
    const safeWatermark = new Date("2026-01-05T12:00:00.000Z");
    const firstStableThrough = new Date("2026-01-05T12:05:00.000Z");
    const lateCommitAt = new Date("2026-01-05T12:01:30.000Z");
    const firstPage = Array.from(
      { length: PURCHASE_DIFF_PAGE_SIZE },
      (_row, index) =>
        createDiffPurchase({
          id: `purchase_first_${index}`,
          blockchainIdentifier: "",
          nextActionOrOnChainStateOrResultLastChangedAt: new Date(
            safeWatermark.getTime() + 60_000 + index * 1_000,
          ),
        }),
    );
    const firstResume = firstPage.at(-1);
    const secondPage = [
      firstResume,
      ...Array.from({ length: PURCHASE_DIFF_PAGE_SIZE - 1 }, (_row, index) =>
        createDiffPurchase({
          id: `purchase_second_${index}`,
          blockchainIdentifier: "",
          nextActionOrOnChainStateOrResultLastChangedAt: new Date(
            safeWatermark.getTime() + 120_000 + index * 1_000,
          ),
        }),
      ),
    ];
    let metadata = {
      cursorId: null as string | null,
      lastSyncedAt: safeWatermark,
    };
    syncMetadataFindUniqueMock.mockImplementation(async () => metadata);
    syncMetadataUpsertMock.mockImplementation(
      async ({
        create,
        update,
      }: {
        create: typeof metadata;
        update: object;
      }) => {
        metadata = { ...metadata, ...create, ...update };
        return metadata;
      },
    );
    syncMetadataUpdateManyMock.mockImplementation(
      async ({ data }: { data: object }) => {
        metadata = { ...metadata, ...data };
        return { count: 1 };
      },
    );
    getPurchasesDiffMock
      .mockResolvedValueOnce(ok(firstPage))
      .mockResolvedValueOnce(ok(secondPage))
      .mockResolvedValueOnce(ok([]))
      .mockImplementationOnce(
        async (changedAt: Date, cursorId: string | null) =>
          changedAt.getTime() <= lateCommitAt.getTime() && cursorId === null
            ? ok([
                createDiffPurchase({
                  id: "purchase_late",
                  blockchainIdentifier: "chain-late",
                  nextActionOrOnChainStateOrResultLastChangedAt: lateCommitAt,
                }),
              ])
            : ok([]),
      );
    jobPurchaseFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        createJobPurchaseRow({
          externalId: "purchase_late",
          job: createJob({
            id: "job_late",
            blockchainIdentifier: "chain-late",
          }),
        }),
      ]);
    const dateNowSpy = vi.spyOn(Date, "now");
    const applyPurchase = vi.fn<ApplyPurchase>().mockResolvedValue(undefined);

    try {
      dateNowSpy.mockReturnValue(
        firstStableThrough.getTime() + PURCHASE_DIFF_REREAD_WINDOW_MS,
      );
      let checksLeft = 2 + PURCHASE_DIFF_PAGE_SIZE;
      await syncPurchasesFromDiff(
        createOptions(applyPurchase, {
          shouldContinue: () => checksLeft-- > 0,
        }),
      );

      dateNowSpy.mockReturnValue(
        new Date("2026-01-05T12:20:00.000Z").getTime(),
      );
      checksLeft = 2 + PURCHASE_DIFF_PAGE_SIZE - 1;
      await syncPurchasesFromDiff(
        createOptions(applyPurchase, {
          shouldContinue: () => checksLeft-- > 0,
        }),
      );

      dateNowSpy.mockReturnValue(
        new Date("2026-01-05T12:30:00.000Z").getTime(),
      );
      await syncPurchasesFromDiff(createOptions(applyPurchase));
      expect(metadata).toMatchObject({
        cursorId: null,
        lastSyncedAt: firstStableThrough,
      });

      dateNowSpy.mockReturnValue(
        new Date("2026-01-05T12:40:00.000Z").getTime(),
      );
      await syncPurchasesFromDiff(createOptions(applyPurchase));

      expect(getPurchasesDiffMock).toHaveBeenNthCalledWith(
        4,
        safeWatermark,
        null,
        PURCHASE_DIFF_PAGE_SIZE,
        expect.anything(),
      );
      expect(applyPurchase).toHaveBeenCalledTimes(1);
      expect(applyPurchase.mock.calls[0][1]).toMatchObject({
        id: "purchase_late",
      });
    } finally {
      dateNowSpy.mockRestore();
    }
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
        update: {
          cursorId: storedCursorContaining("purchase_1"),
          lastSyncedAt: expect.any(Date),
        },
      }),
    );
  });

  it("refuses a row whose blockchain identifier does not match the job", async () => {
    getPurchasesDiffMock.mockResolvedValueOnce(ok([createDiffPurchase()]));
    jobPurchaseFindManyMock.mockResolvedValue([
      createJobPurchaseRow({
        job: createJob({ blockchainIdentifier: "chain-other" }),
      }),
    ]);
    const applyPurchase = vi.fn<ApplyPurchase>();

    await syncPurchasesFromDiff(createOptions(applyPurchase));

    expect(applyPurchase).not.toHaveBeenCalled();
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(syncMetadataUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {
          cursorId: storedCursorContaining("purchase_1"),
          lastSyncedAt: expect.any(Date),
        },
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
        job: createJob({ id: "job_2", blockchainIdentifier: "chain-2" }),
      }),
      createJobPurchaseRow({
        externalId: "purchase_3",
        job: createJob({ id: "job_3", blockchainIdentifier: "chain-3" }),
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
        update: {
          cursorId: storedCursorContaining("purchase_1"),
          lastSyncedAt: expect.any(Date),
        },
      }),
    );
    // Parked, not drained: the next run must retry the row that failed.
    expect(syncMetadataUpdateManyMock).not.toHaveBeenCalled();
  });

  it("keeps the initial checkpoint when the node rejects the request", async () => {
    const { err } = await import("neverthrow");
    getPurchasesDiffMock.mockResolvedValueOnce(err("purchase-diff 500"));

    const result = await syncPurchasesFromDiff(
      createOptions(vi.fn<ApplyPurchase>()),
    );

    expect(result).toEqual({ found: 0, processed: 0 });
    expect(syncMetadataUpsertMock).toHaveBeenCalledTimes(1);
    expect(syncMetadataUpsertMock).toHaveBeenCalledWith({
      where: { key: PURCHASE_DIFF_SYNC_METADATA_KEY },
      create: {
        key: PURCHASE_DIFF_SYNC_METADATA_KEY,
        cursorId: null,
        lastSyncedAt: expect.any(Date),
      },
      update: expect.anything(),
    });
    // The diff is the only path that updates an attached purchase, so a
    // failing request has to page rather than look like a quiet tick.
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it("reuses the initial checkpoint after the first purchase fails", async () => {
    const purchase = createDiffPurchase();
    getPurchasesDiffMock
      .mockResolvedValueOnce(ok([purchase]))
      .mockResolvedValueOnce(ok([purchase]));
    jobPurchaseFindManyMock.mockResolvedValue([createJobPurchaseRow()]);
    const applyPurchase = vi
      .fn<ApplyPurchase>()
      .mockRejectedValueOnce(new Error("write failed"))
      .mockResolvedValueOnce(undefined);

    await syncPurchasesFromDiff(createOptions(applyPurchase));

    const initialCheckpoint = syncMetadataUpsertMock.mock.calls[0]?.[0];
    const initialStart = initialCheckpoint?.create.lastSyncedAt as Date;
    syncMetadataFindUniqueMock.mockResolvedValueOnce({
      cursorId: null,
      lastSyncedAt: initialStart,
    });

    const retryResult = await syncPurchasesFromDiff(
      createOptions(applyPurchase),
    );

    expect(getPurchasesDiffMock).toHaveBeenNthCalledWith(
      2,
      new Date(initialStart.getTime() - PURCHASE_DIFF_REREAD_WINDOW_MS),
      null,
      PURCHASE_DIFF_PAGE_SIZE,
      expect.anything(),
    );
    expect(applyPurchase).toHaveBeenCalledTimes(2);
    expect(retryResult).toEqual({ found: 1, processed: 1 });
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

    expect(syncMetadataUpsertMock).toHaveBeenCalledWith({
      where: { key: PURCHASE_DIFF_SYNC_METADATA_KEY },
      create: {
        key: PURCHASE_DIFF_SYNC_METADATA_KEY,
        cursorId: null,
        lastSyncedAt: new Date(0),
      },
      update: { cursorId: null, lastSyncedAt: new Date(0) },
    });
    expect(getPurchasesDiffMock).toHaveBeenCalledWith(
      new Date(0),
      null,
      PURCHASE_DIFF_PAGE_SIZE,
      expect.anything(),
    );
  });

  it("keeps an epoch checkpoint when the first replay request fails", async () => {
    const { err } = await import("neverthrow");
    getPurchasesDiffMock.mockResolvedValueOnce(err("purchase-diff 500"));

    await syncPurchasesFromDiff(
      createOptions(vi.fn<ApplyPurchase>(), { resetCursor: true }),
    );

    expect(syncMetadataUpsertMock).toHaveBeenCalledWith({
      where: { key: PURCHASE_DIFF_SYNC_METADATA_KEY },
      create: {
        key: PURCHASE_DIFF_SYNC_METADATA_KEY,
        cursorId: null,
        lastSyncedAt: new Date(0),
      },
      update: { cursorId: null, lastSyncedAt: new Date(0) },
    });
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
    // A short page is how a healthy run ends, so this is the path that has to
    // arm the re-read window for the next one.
    expect(syncMetadataUpdateManyMock).toHaveBeenCalledWith({
      where: { key: PURCHASE_DIFF_SYNC_METADATA_KEY },
      data: { cursorId: null, lastSyncedAt: expect.any(Date) },
    });
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
    expect(syncMetadataFindUniqueMock).not.toHaveBeenCalled();
    expect(syncMetadataUpsertMock).not.toHaveBeenCalled();
    expect(result).toEqual({ found: 0, processed: 0 });
  });

  it("does not read the cursor after the run budget expires", async () => {
    const result = await syncPurchasesFromDiff(
      createOptions(vi.fn<ApplyPurchase>(), {
        deadlineMs: Date.now() - 1,
      }),
    );

    expect(syncMetadataFindUniqueMock).not.toHaveBeenCalled();
    expect(syncMetadataUpsertMock).not.toHaveBeenCalled();
    expect(getPurchasesDiffMock).not.toHaveBeenCalled();
    expect(result).toEqual({ found: 0, processed: 0 });
  });

  it("persists a requested replay after the diff budget expires", async () => {
    const result = await syncPurchasesFromDiff(
      createOptions(vi.fn<ApplyPurchase>(), {
        deadlineMs: Date.now() - 1,
        resetCursor: true,
      }),
    );

    expect(syncMetadataUpsertMock).toHaveBeenCalledWith({
      where: { key: PURCHASE_DIFF_SYNC_METADATA_KEY },
      create: {
        key: PURCHASE_DIFF_SYNC_METADATA_KEY,
        cursorId: null,
        lastSyncedAt: new Date(0),
      },
      update: { cursorId: null, lastSyncedAt: new Date(0) },
    });
    expect(getPurchasesDiffMock).not.toHaveBeenCalled();
    expect(result).toEqual({ found: 0, processed: 0 });
  });

  it("does not reset the replay checkpoint once the run is aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await syncPurchasesFromDiff(
      createOptions(vi.fn<ApplyPurchase>(), {
        abortSignal: controller.signal,
        resetCursor: true,
      }),
    );

    expect(syncMetadataUpsertMock).not.toHaveBeenCalled();
    expect(getPurchasesDiffMock).not.toHaveBeenCalled();
  });

  it("does not report an expected in-flight cancellation", async () => {
    const { err } = await import("neverthrow");
    const controller = new AbortController();
    getPurchasesDiffMock.mockImplementationOnce(async () => {
      controller.abort();
      return err("aborted");
    });

    const result = await syncPurchasesFromDiff(
      createOptions(vi.fn<ApplyPurchase>(), {
        abortSignal: controller.signal,
      }),
    );

    expect(result).toEqual({ found: 0, processed: 0 });
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("reports a request timeout while the run budget remains", async () => {
    const { err } = await import("neverthrow");
    const timeoutController = new AbortController();
    timeoutController.abort();
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValueOnce(timeoutController.signal);
    getPurchasesDiffMock.mockResolvedValueOnce(err("aborted"));

    try {
      await syncPurchasesFromDiff(createOptions(vi.fn<ApplyPurchase>()));
    } finally {
      timeoutSpy.mockRestore();
    }

    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
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
    // One check before the cursor read, one before the request, then one per
    // row: the second row is the one that must fall outside the budget.
    let checksLeft = 3;
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
        update: {
          cursorId: storedCursorContaining("purchase_1"),
          lastSyncedAt: expect.any(Date),
        },
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
      createOptions(vi.fn<ApplyPurchase>(), { deadlineMs: Date.now() + 500 }),
    );

    expect(getPurchasesDiffMock).toHaveBeenCalledTimes(2);
    expect(result.found).toBe(PURCHASE_DIFF_PAGE_SIZE * 2);
  });

  it("continues when the cursor purchase moves to a newer timestamp", async () => {
    const movedAt = new Date(CHANGED_AT.getTime() + 60_000);
    syncMetadataFindUniqueMock.mockResolvedValue(
      createStoredCursor("purchase_resume"),
    );
    const movedPage = [
      ...Array.from({ length: PURCHASE_DIFF_PAGE_SIZE - 1 }, (_row, index) =>
        createDiffPurchase({ id: `purchase_${index}` }),
      ),
      createDiffPurchase({
        id: "purchase_resume",
        nextActionOrOnChainStateOrResultLastChangedAt: movedAt,
      }),
    ];
    getPurchasesDiffMock
      .mockResolvedValueOnce(ok(movedPage))
      .mockResolvedValueOnce(ok([]));

    await syncPurchasesFromDiff(createOptions(vi.fn<ApplyPurchase>()));

    expect(getPurchasesDiffMock).toHaveBeenCalledTimes(2);
    expect(getPurchasesDiffMock).toHaveBeenNthCalledWith(
      2,
      movedAt,
      "purchase_resume",
      PURCHASE_DIFF_PAGE_SIZE,
      expect.anything(),
    );
  });
});
