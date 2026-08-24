import { beforeEach, describe, expect, it, vi } from "vitest";

const { captureMessageMock } = vi.hoisted(() => ({
  captureMessageMock: vi.fn(),
}));

vi.mock("@sentry/node", () => ({ captureMessage: captureMessageMock }));

// Pin the environment split; the verify path reads getEnv().NETWORK.
vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({ ...actual.getEnv(), NETWORK: "Preprod" as const }),
  };
});

import {
  buildStoredSignedResponse,
  normalizeWithSourcesOrThrow,
  resolveExistingPayment,
  TASK_X402_MAX_SIGN_ATTEMPTS,
  TASK_X402_SIGN_LEASE_MS,
  TASK_X402_SIGN_REQUEST_TIMEOUT_MS,
  X402_MIN_REMAINING_VALIDITY_MS,
} from "./task-x402-payment.replay";
import {
  AGENT_ID,
  BASE_MAINNET,
  BASE_SEPOLIA,
  captureThrow,
  createTx,
  OTHER_PAY_TO,
  PAY_TO,
  PAYMENT_ID,
  paymentRequired,
  replayInput,
  STORED_PAYMENT_HEADER,
  storedRecord,
  TASK_OWNER_ID,
  USDC,
} from "./task-x402-payment.replay.fixtures";

describe("normalizeWithSourcesOrThrow", () => {
  it("returns the normalized v2 shape with paired sources for a valid 402", () => {
    const normalization = normalizeWithSourcesOrThrow(paymentRequired());
    expect(normalization.paymentRequired.accepts[0]?.amount).toBe("250000");
    expect(normalization.requirementSources).toHaveLength(1);
  });

  it("throws for an unparseable 402", () => {
    expect(() => normalizeWithSourcesOrThrow({ nonsense: true })).toThrow();
  });
});

describe("buildStoredSignedResponse", () => {
  it("returns the stored tuple for a complete VERIFIED record", () => {
    const record = storedRecord({
      status: "VERIFIED",
      attemptId: "attempt_stored",
      xPaymentHeader: STORED_PAYMENT_HEADER,
    });
    expect(buildStoredSignedResponse(record)).toEqual({
      paymentId: PAYMENT_ID,
      attemptId: "attempt_stored",
      paymentHeader: {
        x402Version: 2,
        name: "PAYMENT-SIGNATURE",
        value: STORED_PAYMENT_HEADER,
      },
      caip2Network: BASE_SEPOLIA,
      asset: USDC,
      amount: "250000",
      payTo: PAY_TO,
    });
  });

  it("throws when a supposedly-verified record is missing its signed result", () => {
    expect(() =>
      buildStoredSignedResponse(
        storedRecord({ status: "VERIFIED", attemptId: null }),
      ),
    ).toThrow(/missing its signed result/);
  });
});

describe("resolveExistingPayment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(["FAILED", "REFUNDED"] as const)(
    "treats a %s record as a consumed key",
    async (status) => {
      const tx = createTx();
      const err = await captureThrow(
        resolveExistingPayment(
          storedRecord({ status, failureReason: "budget exhausted" }),
          replayInput(),
          TASK_OWNER_ID,
          tx,
        ),
      );
      expect(err.status).toBe(409);
      expect(err.cause?.kind).toBe("x402_payment_key_consumed");
    },
  );

  it.each(["PENDING", "VERIFIED"] as const)(
    "rejects a %s replay from a different, unrelated agent as a reused key",
    async (status) => {
      const tx = createTx();
      const err = await captureThrow(
        resolveExistingPayment(
          storedRecord({
            status,
            attemptId: status === "VERIFIED" ? "attempt_stored" : null,
            xPaymentHeader:
              status === "VERIFIED" ? STORED_PAYMENT_HEADER : null,
          }),
          { ...replayInput(), agentId: "agent_other" },
          TASK_OWNER_ID,
          tx,
        ),
      );
      expect(err.status).toBe(409);
      expect(err.cause?.kind).toBe("x402_payment_key_reused");
    },
  );

  it("accepts a replay whose supplied agent was parked and consolidated into the stored one", async () => {
    // Registry sync can repoint a payment row's agentId from a rollback-era
    // duplicate to the canonical agent while the coworker still replays with
    // the id it originally paid. That replay is the same intent: answering
    // key-reused would instruct a second charge for an already-paid header.
    const tx = createTx(null, {
      suppliedAgent: {
        blockchainIdentifier: `legacy-v2:${AGENT_ID}:chain-identifier-1`,
      },
      canonicalAgent: { id: "agent_canonical" },
    });
    const outcome = await resolveExistingPayment(
      storedRecord({
        status: "VERIFIED",
        agentId: "agent_canonical",
        attemptId: "attempt_stored",
        xPaymentHeader: STORED_PAYMENT_HEADER,
      }),
      replayInput({ readySources: [] }),
      TASK_OWNER_ID,
      tx,
    );

    expect(outcome.kind).toBe("replay_verified");
  });

  it("rejects a parked agent consolidated into a DIFFERENT canonical as a reused key", async () => {
    const tx = createTx(null, {
      suppliedAgent: {
        blockchainIdentifier: `legacy-v2:${AGENT_ID}:chain-identifier-1`,
      },
      canonicalAgent: { id: "agent_someone_else" },
    });
    const err = await captureThrow(
      resolveExistingPayment(
        storedRecord({
          status: "VERIFIED",
          agentId: "agent_canonical",
          attemptId: "attempt_stored",
          xPaymentHeader: STORED_PAYMENT_HEADER,
        }),
        replayInput({ readySources: [] }),
        TASK_OWNER_ID,
        tx,
      ),
    );

    expect(err.cause?.kind).toBe("x402_payment_key_reused");
  });

  it("answers header_expired when less than the minimum usable life remains", async () => {
    // The floor mirrors finalize's insufficient_remaining_lifetime gate:
    // a header with seconds of life cannot survive delivery, so handing it
    // out burns the coworker's request before landing on this same 409.
    const shortlyExpiring = storedRecord({
      status: "VERIFIED",
      attemptId: "attempt_stored",
      xPaymentHeader: STORED_PAYMENT_HEADER,
      validBefore: new Date(Date.now() + X402_MIN_REMAINING_VALIDITY_MS / 2),
    });
    const tx = createTx(null, { lockedPayment: shortlyExpiring });
    const err = await captureThrow(
      resolveExistingPayment(shortlyExpiring, replayInput(), TASK_OWNER_ID, tx),
    );

    expect(err.status).toBe(409);
    expect(err.cause?.kind).toBe("x402_payment_header_expired");
    expect(tx.taskX402Payment.update).not.toHaveBeenCalled();
  });

  it("returns the stored result for a matching VERIFIED replay without re-signing", async () => {
    const verified = storedRecord({
      status: "VERIFIED",
      attemptId: "attempt_stored",
      xPaymentHeader: STORED_PAYMENT_HEADER,
    });
    const tx = createTx(null, { lockedPayment: verified });
    const outcome = await resolveExistingPayment(
      verified,
      replayInput(),
      TASK_OWNER_ID,
      tx,
    );
    expect(outcome).toEqual({
      kind: "replay_verified",
      payment: expect.objectContaining({ paymentId: PAYMENT_ID }),
    });
    expect(tx.taskX402Payment.update).not.toHaveBeenCalled();
    expect(tx.agent.findFirst).not.toHaveBeenCalled();
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.taskX402Payment.findUnique).toHaveBeenCalledWith({
      where: { id: PAYMENT_ID },
      select: expect.objectContaining({ status: true, xPaymentHeader: true }),
    });
  });

  it("refuses to re-issue a header when a concurrent goodwill refund flipped VERIFIED to REFUNDED", async () => {
    // Stale unlocked preflight still says VERIFIED; the FOR UPDATE reload
    // sees the admin refund that restored credits and left the header stored.
    const staleVerified = storedRecord({
      status: "VERIFIED",
      attemptId: "attempt_stored",
      xPaymentHeader: STORED_PAYMENT_HEADER,
    });
    const refundedUnderLock = storedRecord({
      status: "REFUNDED",
      attemptId: "attempt_stored",
      xPaymentHeader: STORED_PAYMENT_HEADER,
      failureReason: null,
    });
    const tx = createTx(null, { lockedPayment: refundedUnderLock });
    const err = await captureThrow(
      resolveExistingPayment(staleVerified, replayInput(), TASK_OWNER_ID, tx),
    );

    expect(err.status).toBe(409);
    expect(err.cause?.kind).toBe("x402_payment_key_consumed");
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.taskX402Payment.findUnique).toHaveBeenCalled();
  });

  it("returns a VERIFIED replay when a same-pair sibling changes only selection terms", async () => {
    const tx = createTx(null);
    const storedEntry = {
      scheme: "exact",
      network: BASE_SEPOLIA,
      asset: USDC,
      amount: "250000",
      payTo: PAY_TO,
      maxTimeoutSeconds: 60,
      extra: { name: "USDC", version: "2" },
    };
    const outcome = await resolveExistingPayment(
      storedRecord({
        status: "VERIFIED",
        attemptId: "attempt_stored",
        xPaymentHeader: STORED_PAYMENT_HEADER,
      }),
      replayInput({
        accepts: [storedEntry, { ...storedEntry, maxTimeoutSeconds: 120 }],
        readySources: [],
      }),
      TASK_OWNER_ID,
      tx,
    );

    expect(outcome.kind).toBe("replay_verified");
    expect(tx.agent.findFirst).not.toHaveBeenCalled();
  });

  it("returns a VERIFIED result after the agent is no longer listed", async () => {
    const tx = createTx(null);
    const outcome = await resolveExistingPayment(
      storedRecord({
        status: "VERIFIED",
        attemptId: "attempt_stored",
        xPaymentHeader: STORED_PAYMENT_HEADER,
      }),
      replayInput({ readySources: [] }),
      TASK_OWNER_ID,
      tx,
    );

    expect(outcome.kind).toBe("replay_verified");
    expect(tx.agent.findFirst).not.toHaveBeenCalled();
  });

  it.each(["PENDING", "VERIFIED"] as const)(
    "holds a legacy %s replay without a fingerprint instead of suggesting a second charge",
    async (status) => {
      const tx = createTx(null);
      const err = await captureThrow(
        resolveExistingPayment(
          storedRecord({
            status,
            attemptId: status === "VERIFIED" ? "attempt_stored" : null,
            xPaymentHeader:
              status === "VERIFIED" ? STORED_PAYMENT_HEADER : null,
            demandFingerprint: null,
          }),
          replayInput({ readySources: [] }),
          TASK_OWNER_ID,
          tx,
        ),
      );

      expect(err.cause?.kind).toBe("x402_payment_demand_unbound");
      expect(tx.agent.findFirst).not.toHaveBeenCalled();
    },
  );

  it("rejects a VERIFIED replay that changes the x402 protocol version", async () => {
    const tx = createTx(null);
    const input = replayInput({ readySources: [] });
    const err = await captureThrow(
      resolveExistingPayment(
        storedRecord({
          status: "VERIFIED",
          attemptId: "attempt_stored",
          xPaymentHeader: STORED_PAYMENT_HEADER,
        }),
        {
          ...input,
          normalized: { ...input.normalized, x402Version: 1 },
        },
        TASK_OWNER_ID,
        tx,
      ),
    );

    expect(err.cause?.kind).toBe("x402_payment_key_reused");
  });

  it("rejects a VERIFIED replay that changes signed timeout terms", async () => {
    const tx = createTx(null);
    const entry = {
      scheme: "exact",
      network: BASE_SEPOLIA,
      asset: USDC,
      amount: "250000",
      payTo: PAY_TO,
      maxTimeoutSeconds: 120,
    };
    const err = await captureThrow(
      resolveExistingPayment(
        storedRecord({
          status: "VERIFIED",
          attemptId: "attempt_stored",
          xPaymentHeader: STORED_PAYMENT_HEADER,
        }),
        replayInput({ accepts: [entry], readySources: [] }),
        TASK_OWNER_ID,
        tx,
      ),
    );

    expect(err.cause?.kind).toBe("x402_payment_key_reused");
  });

  it("rejects a VERIFIED replay with a poisoned sibling on the stored pair", async () => {
    const tx = createTx(null);
    const storedEntry = {
      scheme: "exact",
      network: BASE_SEPOLIA,
      asset: USDC,
      amount: "250000",
      payTo: PAY_TO,
      maxTimeoutSeconds: 60,
    };
    const err = await captureThrow(
      resolveExistingPayment(
        storedRecord({
          status: "VERIFIED",
          attemptId: "attempt_stored",
          xPaymentHeader: STORED_PAYMENT_HEADER,
        }),
        replayInput({
          accepts: [
            storedEntry,
            {
              ...storedEntry,
              amount: "999999999",
              payTo: OTHER_PAY_TO,
            },
          ],
          readySources: [],
        }),
        TASK_OWNER_ID,
        tx,
      ),
    );

    expect(err.cause?.kind).toBe("x402_payment_key_reused");
    expect(tx.agent.findFirst).not.toHaveBeenCalled();
  });

  it("answers a VERIFIED replay whose header the purge cleared with a 409, not a 500", async () => {
    // The purge nulls `xPaymentHeader` on VERIFIED rows once the
    // authorization can no longer settle, so "VERIFIED implies a header" is no
    // longer an invariant: coworker pays, the node signs with
    // `validBefore = now + 3600`, the hourly sweep runs 1–2 h later, and the
    // same-key replay then reached `buildStoredSignedResponse` with a null
    // header and threw a bare 500. Money-safe, but the wrong answer — the
    // coworker cannot tell "your authorization expired, mint a new key" from
    // "Soko is broken, retry".
    const purged = storedRecord({
      status: "VERIFIED",
      attemptId: "attempt_stored",
      xPaymentHeader: null,
    });
    const tx = createTx(null, { lockedPayment: purged });
    const err = await captureThrow(
      resolveExistingPayment(purged, replayInput(), TASK_OWNER_ID, tx),
    );

    expect(err.status).toBe(409);
    expect(err.cause?.kind).toBe("x402_payment_header_expired");
    // Still a replay, never a re-sign: the charge was already settled for.
    expect(tx.taskX402Payment.update).not.toHaveBeenCalled();
  });

  it("rejects an expired VERIFIED header before the purge clears it", async () => {
    const expired = storedRecord({
      status: "VERIFIED",
      attemptId: "attempt_stored",
      xPaymentHeader: STORED_PAYMENT_HEADER,
      validBefore: new Date(Date.now() - 1),
    });
    const tx = createTx(null, { lockedPayment: expired });
    const err = await captureThrow(
      resolveExistingPayment(expired, replayInput(), TASK_OWNER_ID, tx),
    );

    expect(err.status).toBe(409);
    expect(err.cause?.kind).toBe("x402_payment_header_expired");
    expect(tx.taskX402Payment.update).not.toHaveBeenCalled();
  });

  it("reports a reused key before it reports an expired header", async () => {
    // The demand re-verification runs first, so a caller replaying a purged
    // key with a DIFFERENT 402 learns nothing about what the stored row holds.
    const mismatched = storedRecord({
      status: "VERIFIED",
      attemptId: "attempt_stored",
      xPaymentHeader: null,
      caip2Network: "eip155:8453",
    });
    const tx = createTx(null, { lockedPayment: mismatched });
    const err = await captureThrow(
      resolveExistingPayment(mismatched, replayInput(), TASK_OWNER_ID, tx),
    );

    expect(err.cause?.kind).toBe("x402_payment_key_reused");
  });

  it("re-signs a PENDING replay under the cap and bumps the counter", async () => {
    const tx = createTx();
    const outcome = await resolveExistingPayment(
      storedRecord({ signAttemptCount: 2 }),
      replayInput(),
      TASK_OWNER_ID,
      tx,
    );
    expect(outcome).toMatchObject({
      kind: "sign",
      paymentId: PAYMENT_ID,
      chargedNow: false,
      evmWalletId: "wallet-1",
      caip2Network: BASE_SEPOLIA,
      asset: USDC,
      amount: "250000",
      payTo: PAY_TO,
    });
    expect(tx.taskX402Payment.update).toHaveBeenCalledWith({
      where: { id: PAYMENT_ID },
      data: {
        signAttemptCount: { increment: 1 },
        processingAt: expect.any(Date),
        signRiskExpiresAt: expect.any(Date),
      },
    });
  });

  it("refuses a PENDING replay whose sign lease is still held, before the readiness lookup", async () => {
    const tx = createTx();
    const err = await captureThrow(
      resolveExistingPayment(
        storedRecord({ signAttemptCount: 1, processingAt: new Date() }),
        replayInput(),
        TASK_OWNER_ID,
        tx,
      ),
    );
    expect(err.status).toBe(409);
    expect(err.cause?.kind).toBe("x402_payment_key_in_flight");
    // No attempt spent, no lease re-stamped, no readiness lookup: the holder
    // owns this round-trip.
    expect(tx.taskX402Payment.update).not.toHaveBeenCalled();
  });

  it("takes over a lease older than TASK_X402_SIGN_LEASE_MS so a crash cannot wedge the key", async () => {
    const tx = createTx();
    const outcome = await resolveExistingPayment(
      storedRecord({
        signAttemptCount: 1,
        processingAt: new Date(Date.now() - TASK_X402_SIGN_LEASE_MS - 1),
      }),
      replayInput(),
      TASK_OWNER_ID,
      tx,
    );
    expect(outcome).toMatchObject({ kind: "sign", paymentId: PAYMENT_ID });
  });

  it("keeps the lease longer than the node request it covers", () => {
    // The invariant the lease rests on: if it expired first, a second request
    // could take it over while the first is still at the node — the exact
    // race the lease exists to prevent.
    expect(TASK_X402_SIGN_LEASE_MS).toBeGreaterThan(
      TASK_X402_SIGN_REQUEST_TIMEOUT_MS,
    );
  });

  it("refuses a PENDING replay at the sign-attempt cap before the readiness lookup", async () => {
    const tx = createTx();
    const err = await captureThrow(
      resolveExistingPayment(
        storedRecord({ signAttemptCount: TASK_X402_MAX_SIGN_ATTEMPTS }),
        replayInput(),
        TASK_OWNER_ID,
        tx,
      ),
    );
    expect(err.status).toBe(409);
    expect(err.cause?.kind).toBe("x402_payment_sign_attempts_exhausted");
    expect(tx.taskX402Payment.update).not.toHaveBeenCalled();
  });

  it("holds a PENDING replay whose pair is no longer ready and pages ops", async () => {
    const tx = createTx();
    const err = await captureThrow(
      resolveExistingPayment(
        storedRecord(),
        replayInput({ readySources: [] }),
        TASK_OWNER_ID,
        tx,
      ),
    );
    expect(err.status).toBe(502);
    expect(captureMessageMock).toHaveBeenCalledWith(
      expect.stringContaining("PENDING replay held"),
      expect.objectContaining({
        tags: { error_type: "task_x402_payment_pending_held" },
      }),
    );
    expect(tx.taskX402Payment.update).not.toHaveBeenCalled();
  });

  it("rejects a poisoned sibling as a reused key BEFORE any catalog read", async () => {
    // The tx has NO listed agent: if the resolver consulted the catalog
    // before proving the demand, this would answer the held 502. The
    // key-reused answer proves the catalog-free fingerprint proof ran first.
    const tx = createTx(null);
    const err = await captureThrow(
      resolveExistingPayment(
        storedRecord(),
        replayInput({
          accepts: [
            {
              scheme: "exact",
              network: BASE_SEPOLIA,
              asset: USDC,
              amount: "250000",
              payTo: PAY_TO,
              maxTimeoutSeconds: 60,
              extra: { name: "USDC", version: "2" },
            },
            {
              scheme: "exact",
              network: BASE_SEPOLIA,
              asset: USDC,
              amount: "999999999",
              payTo: OTHER_PAY_TO,
              maxTimeoutSeconds: 60,
            },
          ],
        }),
        TASK_OWNER_ID,
        tx,
      ),
    );
    expect(err.cause?.kind).toBe("x402_payment_key_reused");
    expect(tx.taskX402Payment.update).not.toHaveBeenCalled();
  });

  it("holds a PENDING replay when the agent is no longer listed", async () => {
    // Listing state is transient and proves nothing about the demand — the
    // fingerprint proof already matched it. A key-reused answer here would
    // advise a second charge while the held charge (and possibly a live
    // authorization from an earlier ambiguous attempt) exists.
    const tx = createTx(null);
    const err = await captureThrow(
      resolveExistingPayment(storedRecord(), replayInput(), TASK_OWNER_ID, tx),
    );
    expect(err.status).toBe(502);
    expect(err.cause?.kind).toBe("x402_pay_pending_held");
    expect(captureMessageMock).toHaveBeenCalledWith(
      expect.stringContaining("PENDING replay held"),
      expect.objectContaining({
        tags: { error_type: "task_x402_payment_pending_held" },
      }),
    );
    expect(tx.taskX402Payment.update).not.toHaveBeenCalled();
  });

  it("rejects a PENDING replay demanding a different network without re-signing", async () => {
    const tx = createTx();
    const err = await captureThrow(
      resolveExistingPayment(
        storedRecord(),
        replayInput({
          accepts: [
            {
              scheme: "exact",
              network: BASE_MAINNET,
              asset: USDC,
              amount: "250000",
              payTo: PAY_TO,
              maxTimeoutSeconds: 60,
            },
          ],
        }),
        TASK_OWNER_ID,
        tx,
      ),
    );
    expect(err.cause?.kind).toBe("x402_payment_key_reused");
    expect(tx.taskX402Payment.update).not.toHaveBeenCalled();
  });
});
