import type { Prisma } from "@sokosumi/database";
import { normalizeX402PaymentRequiredWithSources } from "@sokosumi/masumi/schemas";
import { vi } from "vitest";

import { createX402DemandFingerprint } from "@/services/task-x402-payment.replay-demand";

import type { StoredTaskX402Payment } from "./task-x402-payment.replay";

/**
 * Shared test fixtures for the replay resolver and its demand-verification
 * split (`task-x402-payment.replay` / `.replay-demand`). Test-only; imported
 * by both `.test.ts` files so the split cannot drift the two suites onto
 * different fixture shapes.
 */

export const AGENT_ID = "agent_x402_1";
export const PAYMENT_ID = "pay_1";
export const TASK_OWNER_ID = "user_owner";
export const BASE_SEPOLIA = "eip155:84532";
export const BASE_MAINNET = "eip155:8453";
export const USDC = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
export const PAY_TO = "0x1111111111111111111111111111111111111111";
export const OTHER_PAY_TO = "0x3333333333333333333333333333333333333333";
export const STORED_PAYMENT_HEADER = Buffer.from(
  JSON.stringify({ x402Version: 2 }),
).toString("base64");

export interface ThrownHttpError {
  status?: number;
  cause?: { kind?: string };
}

export async function captureThrow(
  promise: Promise<unknown>,
): Promise<ThrownHttpError> {
  try {
    await promise;
  } catch (error) {
    return error as ThrownHttpError;
  }
  throw new Error("expected the call to throw");
}

export function agentRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: AGENT_ID,
    type: "X402",
    x402ResourcesUrl: "https://agent.example.com/.well-known/x402",
    openApiSpecUrl: null,
    paymentSources: [
      {
        sourceIndex: 0,
        network: BASE_SEPOLIA,
        payTo: PAY_TO,
        scheme: "exact",
        pricingType: "FIXED",
        amounts: [{ unit: USDC, amount: 250000n, decimals: 6 }],
      },
    ],
    ...overrides,
  };
}

export function storedRecord(
  overrides: Partial<StoredTaskX402Payment> = {},
): StoredTaskX402Payment {
  const original = verificationInput();
  return {
    id: PAYMENT_ID,
    status: "PENDING",
    agentId: AGENT_ID,
    caip2Network: BASE_SEPOLIA,
    asset: USDC,
    amount: "250000",
    payTo: PAY_TO,
    demandFingerprint: createX402DemandFingerprint(
      original.normalized,
      original.requirementSources[0]?.source ?? {},
    ),
    attemptId: null,
    xPaymentHeader: null,
    validBefore: new Date(Date.now() + 60_000),
    failureReason: null,
    signAttemptCount: 0,
    processingAt: null,
    ...overrides,
  };
}

export function paymentRequired(accepts?: unknown[]) {
  return {
    x402Version: 2,
    accepts: accepts ?? [
      {
        scheme: "exact",
        network: BASE_SEPOLIA,
        asset: USDC,
        amount: "250000",
        payTo: PAY_TO,
        maxTimeoutSeconds: 60,
        extra: { name: "USDC", version: "2" },
      },
    ],
  };
}

export const READY_SOURCES = [
  {
    caip2Network: BASE_SEPOLIA,
    asset: USDC,
    evmWalletId: "wallet-1",
    evmWalletAddress: "0x52e29e0d2aa49bfbfc548c0a9f2196f4aa51f3ea",
    decimals: 6,
  },
];

/**
 * The 402 arrives already normalized: parsing happens before the serializable
 * charge transaction opens, so the replay helpers never see raw input.
 */
export function verificationInput(accepts?: unknown[]) {
  const normalization = normalizeX402PaymentRequiredWithSources(
    paymentRequired(accepts),
  );
  if (normalization.isErr()) {
    throw new Error("invalid payment-required test fixture");
  }
  return {
    agentId: AGENT_ID,
    normalized: normalization.value.paymentRequired,
    requirementSources: normalization.value.requirementSources,
  };
}

/** Readiness is likewise pre-read, outside the charge transaction. */
export function replayInput(
  overrides: { accepts?: unknown[]; readySources?: typeof READY_SOURCES } = {},
) {
  return {
    ...verificationInput(overrides.accepts),
    readySources: overrides.readySources ?? READY_SOURCES,
  };
}

export function createTx(
  agent: ReturnType<typeof agentRow> | null = agentRow(),
  options: {
    /** What `agent.findUnique` (the parked-alias lookup) resolves to. */
    suppliedAgent?: { blockchainIdentifier: string } | null;
    /** What the by-identifier `agent.findFirst` resolves to. */
    canonicalAgent?: { id: string } | null;
    /**
     * Row returned after the VERIFIED replay FOR UPDATE lock. Defaults to a
     * live VERIFIED record so happy-path tests need no extra wiring; pass an
     * override to simulate expiry or a concurrent goodwill refund.
     */
    lockedPayment?: StoredTaskX402Payment | null;
  } = {},
) {
  const defaultLockedPayment = storedRecord({
    status: "VERIFIED",
    attemptId: "attempt_stored",
    xPaymentHeader: STORED_PAYMENT_HEADER,
  });
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
    agent: {
      findUnique: vi.fn().mockResolvedValue(options.suppliedAgent ?? null),
      // Two callers share this mock: the catalog lookup (findListedX402Agent,
      // keyed on id) and the parked-alias canonical lookup (keyed on
      // blockchainIdentifier). Branch on the where shape.
      findFirst: vi.fn().mockImplementation((args: unknown) => {
        const where = (args as { where?: Record<string, unknown> }).where;
        if (where && "blockchainIdentifier" in where) {
          return Promise.resolve(options.canonicalAgent ?? null);
        }
        return Promise.resolve(agent);
      }),
    },
    taskX402Payment: {
      update: vi.fn().mockResolvedValue({}),
      findUnique: vi
        .fn()
        .mockResolvedValue(
          options.lockedPayment === undefined
            ? defaultLockedPayment
            : options.lockedPayment,
        ),
    },
  } as unknown as Prisma.TransactionClient;
}
