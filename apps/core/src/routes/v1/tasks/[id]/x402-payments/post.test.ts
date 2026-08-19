import { OpenAPIHono } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";
import {
  normalizeX402PaymentRequiredWithSources,
  X402_MAX_ENCODED_PAYLOAD_LENGTH,
  X402_MAX_TIMEOUT_SECONDS,
} from "@sokosumi/masumi/schemas";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { err, ok } from "neverthrow";
import { privateKeyToAccount } from "viem/accounts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { formatZodErrorMessage, unprocessableEntity } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import { TASK_X402_MAX_SIGN_DISPATCH_DELAY_MS } from "@/services/task-x402-payment.replay";
import { createX402DemandFingerprint } from "@/services/task-x402-payment.replay-demand";

import mountPostTaskX402Payment, { X402_PAY_MAX_BODY_BYTES } from "./post";

const {
  captureExceptionMock,
  captureMessageMock,
  createNotificationMock,
  createTaskEventTransactionMock,
  getCreditCostsOrThrowMock,
  getX402ReadySourcesMock,
  outerPaymentFindUniqueMock,
  outerPaymentUpdateManyMock,
  payX402Mock,
  preflightPaymentFindUniqueMock,
  prismaTaskFindUniqueMock,
  prismaTransactionMock,
  publishTaskEventDataMock,
  requireTaskCollaborationMock,
  waitUntilCapturedPromises,
} = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
  captureMessageMock: vi.fn(),
  createNotificationMock: vi.fn(),
  createTaskEventTransactionMock: vi.fn(),
  getCreditCostsOrThrowMock: vi.fn(),
  getX402ReadySourcesMock: vi.fn(),
  outerPaymentFindUniqueMock: vi.fn(),
  outerPaymentUpdateManyMock: vi.fn(),
  payX402Mock: vi.fn(),
  preflightPaymentFindUniqueMock: vi.fn(),
  prismaTaskFindUniqueMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  publishTaskEventDataMock: vi.fn(),
  requireTaskCollaborationMock: vi.fn(),
  waitUntilCapturedPromises: [] as Promise<unknown>[],
}));

vi.mock("@sentry/node", () => ({
  captureException: captureExceptionMock,
  captureMessage: captureMessageMock,
}));

// Pin the environment split without discarding the rest of the config —
// modules loaded through the route's import graph read other env keys at
// module load.
vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      NETWORK: "Preprod" as const,
    }),
  };
});

vi.mock("@/helpers/access-control", () => ({
  requireTaskCollaboration: requireTaskCollaborationMock,
}));

vi.mock("@/helpers/task-credits", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/helpers/task-credits")>();
  return {
    ...actual,
    createTaskEventTransaction: createTaskEventTransactionMock,
  };
});

vi.mock("@/helpers/agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/helpers/agent")>();
  return {
    ...actual,
    getCreditCostsOrThrow: getCreditCostsOrThrowMock,
  };
});

vi.mock("@/helpers/x402-readiness", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/helpers/x402-readiness")>();
  return {
    ...actual,
    getX402ReadySources: getX402ReadySourcesMock,
  };
});

vi.mock("@/clients/masumi-payment.client", () => ({
  paymentClient: () => ({ payX402: payX402Mock }),
}));

vi.mock("@/helpers/notifications", () => ({
  createNotification: createNotificationMock,
}));

vi.mock("@/lib/ably/publish", () => ({
  publishTaskEventData: publishTaskEventDataMock,
}));

vi.mock("@vercel/functions", () => ({
  waitUntil: (promise: Promise<unknown>) => {
    waitUntilCapturedPromises.push(promise);
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
    taskX402Payment: {
      updateMany: outerPaymentUpdateManyMock,
      // Two non-tx readers share this delegate: the charge-phase preflight
      // (keyed on the idempotency pair) and finalize's post-claim re-read
      // (keyed on id). Dispatch on the where shape.
      findUnique: (args: { where?: Record<string, unknown> }) =>
        args.where && "taskId_idempotencyKey" in args.where
          ? preflightPaymentFindUniqueMock(args)
          : outerPaymentFindUniqueMock(args),
    },
    task: {
      findUnique: prismaTaskFindUniqueMock,
    },
  },
}));

const TASK_ID = "tsk_123";
const USER_ID = "user_123";
const COWORKER_ID = "cow_123";
const AGENT_ID = "agent_x402_1";
const PAYMENT_ID = "pay_1";
const IDEMPOTENCY_KEY = "intent-1";

const BASE_SEPOLIA = "eip155:84532";
const BASE_MAINNET = "eip155:8453";
const USDC_ADDRESS = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
/** A second registered asset on the same chain, priced far above USDC. */
const EXPENSIVE_ASSET = "0x8888888888888888888888888888888888888888";
const PAY_TO = "0x1111111111111111111111111111111111111111";
const OTHER_PAY_TO = "0x3333333333333333333333333333333333333333";
const TEST_PAYER_PRIVATE_KEY = `0x${"01".repeat(32)}` as const;
const PAYER_ACCOUNT = privateKeyToAccount(TEST_PAYER_PRIVATE_KEY);
const PAYER = PAYER_ACCOUNT.address.toLowerCase();
const PAYLOAD_NONCE = `0x${"ab".repeat(32)}` as `0x${string}`;
const V1_PAYLOAD_NONCE = `0x${"cd".repeat(32)}` as `0x${string}`;

// 2 credits per whole USDC → 250000 base units (6 decimals) = 0.5 credits.
const CENTS_FOR_DEMAND = 5_000_000_000n;

const COWORKER_AGENT_CONTEXT: AuthenticationContext = {
  actor: "coworker",
  coworkerId: COWORKER_ID,
  vendorId: "vendor_1",
} as AuthenticationContext;

interface TxMock {
  taskX402Payment: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  taskX402PaymentAction: { createMany: ReturnType<typeof vi.fn> };
  taskEvent: { create: ReturnType<typeof vi.fn> };
  task: { updateMany: ReturnType<typeof vi.fn> };
  agent: {
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
}

function createTask(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: TASK_ID,
    status: TaskStatus.RUNNING,
    assigneeId: COWORKER_ID,
    ownerId: USER_ID,
    organizationId: null,
    ...overrides,
  };
}

function createAgentRow(overrides: Partial<Record<string, unknown>> = {}) {
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
        amounts: [{ unit: USDC_ADDRESS, amount: 250000n, decimals: 6 }],
      },
    ],
    ...overrides,
  };
}

function createCreditCostRow(unit: string, centsPerUnit: bigint) {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: `credit-cost-${unit}`,
    createdAt: now,
    updatedAt: now,
    unit,
    centsPerUnit,
  };
}

function create402(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    x402Version: 2,
    accepts: [
      {
        scheme: "exact",
        network: BASE_SEPOLIA,
        asset: USDC_ADDRESS,
        amount: "250000",
        payTo: PAY_TO,
        maxTimeoutSeconds: 60,
        extra: { name: "USDC", version: "2" },
      },
    ],
    extensions: { "payment-identifier": {} },
    ...overrides,
  };
}

function paymentDemandFingerprint(paymentRequired: unknown = create402()) {
  const normalized = normalizeX402PaymentRequiredWithSources(paymentRequired);
  if (normalized.isErr()) {
    throw new Error("invalid payment-required fingerprint fixture");
  }
  const entry = normalized.value.paymentRequired.accepts[0];
  const source = normalized.value.requirementSources[0];
  if (!entry || !source) {
    throw new Error("payment-required fingerprint fixture has no entry");
  }
  return createX402DemandFingerprint(
    { ...normalized.value.paymentRequired, accepts: [entry] },
    source.source,
  );
}

function createPaymentRecord(overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date("2026-02-20T12:00:00.000Z");
  return {
    id: PAYMENT_ID,
    createdAt: now,
    updatedAt: now,
    idempotencyKey: IDEMPOTENCY_KEY,
    status: "PENDING",
    caip2Network: BASE_SEPOLIA,
    asset: USDC_ADDRESS,
    amount: "250000",
    payTo: PAY_TO,
    demandFingerprint: paymentDemandFingerprint(),
    attemptId: null,
    xPaymentHeader: null,
    failureReason: null,
    signAttemptCount: 0,
    payerAddress: null,
    payloadNonce: null,
    paymentPayloadHash: null,
    validBefore: null,
    taskId: TASK_ID,
    agentId: AGENT_ID,
    taskEventId: "evt_charge_1",
    transactionId: "txn_1",
    refundTransactionId: null,
    processingAt: null,
    ...overrides,
  };
}

/**
 * Relative to the run, not a frozen literal. A real node signs
 * `validBefore = now + maxTimeoutSeconds` (≤ 3600 s), and finalize now refuses
 * an authorization whose window has already closed — so a hardcoded timestamp
 * would quietly turn every happy-path test into an expired-header test the day
 * it went past.
 */
const VALID_BEFORE_SECONDS = Math.floor(Date.now() / 1000) + 60;
const MAX_VALID_BEFORE_SECONDS =
  Math.floor(Date.now() / 1000) + X402_MAX_TIMEOUT_SECONDS;

const EIP_3009_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

async function signAuthorization(
  nonce: `0x${string}`,
  validBefore: number,
  validAfter = 0,
  domainName = "USDC",
  domainVersion = "2",
) {
  return await PAYER_ACCOUNT.signTypedData({
    domain: {
      name: domainName,
      version: domainVersion,
      chainId: 84532,
      verifyingContract: USDC_ADDRESS,
    },
    types: EIP_3009_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: PAYER_ACCOUNT.address,
      to: PAY_TO,
      value: 250_000n,
      validAfter: BigInt(validAfter),
      validBefore: BigInt(validBefore),
      nonce,
    },
  });
}

/** Real EIP-712 signatures: production verification must recover this wallet. */
const SIGNATURE = await signAuthorization(PAYLOAD_NONCE, VALID_BEFORE_SECONDS);
const V1_SIGNATURE = await signAuthorization(
  V1_PAYLOAD_NONCE,
  VALID_BEFORE_SECONDS,
);
const MAX_TIMEOUT_SIGNATURE = await signAuthorization(
  PAYLOAD_NONCE,
  MAX_VALID_BEFORE_SECONDS,
);
const WRONG_DOMAIN_SIGNATURE = await signAuthorization(
  PAYLOAD_NONCE,
  VALID_BEFORE_SECONDS,
  0,
  "Counterfeit Coin",
  "9",
);

/**
 * A realistic base64 `X-PAYMENT` header: the EIP-3009 authorization the
 * managed wallet actually signed, inside the envelope that says which chain
 * and which settlement scheme it was signed for. This — not the node's summary
 * scalars — is what the finalize step asserts the charge against, so the
 * fixture has to carry all of it.
 */
function xPaymentHeader(
  authorizationOverrides: Record<string, unknown> = {},
  acceptedOverrides: Record<string, unknown> = {},
  payloadOverrides: Record<string, unknown> = {},
) {
  return Buffer.from(
    JSON.stringify({
      x402Version: 2,
      accepted: {
        scheme: "exact",
        network: BASE_SEPOLIA,
        asset: USDC_ADDRESS,
        amount: "250000",
        payTo: PAY_TO,
        maxTimeoutSeconds: 60,
        extra: { name: "USDC", version: "2" },
        ...acceptedOverrides,
      },
      payload: {
        signature: SIGNATURE,
        authorization: {
          from: PAYER,
          to: PAY_TO,
          value: "250000",
          validAfter: "0",
          validBefore: String(VALID_BEFORE_SECONDS),
          nonce: PAYLOAD_NONCE,
          ...authorizationOverrides,
        },
        ...payloadOverrides,
      },
    }),
    "utf8",
  ).toString("base64");
}

function normalizedPaymentHeader() {
  const envelope = JSON.parse(
    Buffer.from(xPaymentHeader(), "base64").toString("utf8"),
  ) as Record<string, unknown>;
  envelope.accepted = create402().accepts[0];
  return Buffer.from(JSON.stringify(envelope), "utf8").toString("base64");
}

function xPaymentHeaderV1() {
  return Buffer.from(
    JSON.stringify({
      x402Version: 1,
      scheme: "exact",
      network: "base-sepolia",
      payload: {
        signature: V1_SIGNATURE,
        authorization: {
          from: PAYER,
          to: PAY_TO,
          value: "250000",
          validAfter: "0",
          validBefore: String(VALID_BEFORE_SECONDS),
          nonce: V1_PAYLOAD_NONCE,
        },
      },
    }),
    "utf8",
  ).toString("base64");
}

function signedNodePayment(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    attemptId: "attempt_1",
    payer: PAYER,
    caip2Network: BASE_SEPOLIA,
    asset: USDC_ADDRESS,
    amount: "250000",
    payTo: PAY_TO,
    xPaymentHeader: xPaymentHeader(),
    paymentPayload: {
      payload: {
        authorization: {
          nonce: PAYLOAD_NONCE,
          validBefore: String(VALID_BEFORE_SECONDS),
        },
      },
    },
    paymentPayloadHash: "0xhash",
    paymentIdentifier: null,
    ...overrides,
  };
}

function createTxMock(): TxMock {
  return {
    taskX402Payment: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: PAYMENT_ID }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi
        .fn()
        .mockResolvedValue({ refundTransactionId: "refund_txn_1" }),
    },
    taskX402PaymentAction: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    taskEvent: { create: vi.fn().mockResolvedValue({ id: "evt_charge_1" }) },
    task: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    agent: {
      findFirst: vi.fn().mockResolvedValue(createAgentRow()),
      // Replay identity resolution looks up the SUPPLIED agent id; null means
      // "no such agent", which the service treats as an unrelated agent.
      findUnique: vi.fn().mockResolvedValue(null),
    },
  };
}

function createApp(authContext: AuthenticationContext) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & { requestId: string };
  }>({
    defaultHook: (result) => {
      if (!result.success && result.error) {
        throw unprocessableEntity(formatZodErrorMessage(result.error));
      }
    },
  });

  // The real app serializes HTTPExceptions to the JSON error envelope in its
  // onError handler; error-body assertions below need the same.
  app.onError(errorHandler);

  app.use("*", async (c, next) => {
    c.set("requestId", "test-req-id");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  mountPostTaskX402Payment(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

function postPayment(
  app: ReturnType<typeof createApp>,
  body: Record<string, unknown>,
) {
  return app.request(`http://localhost/${TASK_ID}/x402-payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    idempotencyKey: IDEMPOTENCY_KEY,
    agentId: AGENT_ID,
    paymentRequired: create402(),
    ...overrides,
  };
}

let tx: TxMock;

describe("POST /{id}/x402-payments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    waitUntilCapturedPromises.length = 0;

    tx = createTxMock();
    prismaTransactionMock.mockImplementation(
      async (callback: (tx: TxMock) => unknown) => await callback(tx),
    );

    requireTaskCollaborationMock.mockResolvedValue(createTask());
    createTaskEventTransactionMock.mockResolvedValue("txn_1");
    getCreditCostsOrThrowMock.mockResolvedValue([
      createCreditCostRow(
        `${BASE_SEPOLIA}/erc20:${USDC_ADDRESS}`,
        2n * 10n ** 10n,
      ),
    ]);
    getX402ReadySourcesMock.mockResolvedValue([
      {
        caip2Network: BASE_SEPOLIA,
        asset: USDC_ADDRESS,
        evmWalletId: "wallet-1",
        evmWalletAddress: PAYER,
        // The node's own `defaultAssetDecimals` — the authoritative scale, and
        // the only one the charge is allowed to be computed from.
        decimals: 6,
      },
    ]);
    payX402Mock.mockResolvedValue(ok(signedNodePayment()));
    outerPaymentUpdateManyMock.mockResolvedValue({ count: 1 });
    outerPaymentFindUniqueMock.mockResolvedValue(null);
    preflightPaymentFindUniqueMock.mockResolvedValue(null);
    publishTaskEventDataMock.mockResolvedValue(undefined);
    createNotificationMock.mockResolvedValue({
      notification: { id: "notif_1" },
      created: true,
    });
    prismaTaskFindUniqueMock.mockResolvedValue({
      id: TASK_ID,
      ownerId: USER_ID,
      name: "Test task",
      projectId: null,
      workspaceId: null,
      assignee: { name: "Test coworker" },
      project: null,
      owner: { notificationsOptIn: true },
    });
  });

  describe("authorization", () => {
    it("rejects a user session actor with 403 before any transaction", async () => {
      const app = createApp({
        actor: "user",
        userId: USER_ID,
        organizationId: null,
        role: "user",
      } as AuthenticationContext);

      const response = await postPayment(app, validBody());

      expect(response.status).toBe(403);
      expect(prismaTransactionMock).not.toHaveBeenCalled();
      expect(payX402Mock).not.toHaveBeenCalled();
    });

    it("rejects an orchestrator actor with 403", async () => {
      const app = createApp({ actor: "orchestrator" } as AuthenticationContext);

      const response = await postPayment(app, validBody());

      expect(response.status).toBe(403);
      expect(prismaTransactionMock).not.toHaveBeenCalled();
    });

    it("rejects a delegated coworker after collaboration succeeds", async () => {
      const app = createApp({
        ...COWORKER_AGENT_CONTEXT,
        context: { userId: USER_ID, organizationId: null },
      } as AuthenticationContext);

      const response = await postPayment(app, validBody());

      expect(response.status).toBe(403);
      const body = (await response.json()) as { message?: string };
      expect(body.message).toContain("Direct coworker authentication required");
      expect(requireTaskCollaborationMock).toHaveBeenCalledWith(
        expect.objectContaining({ context: expect.any(Object) }),
        TASK_ID,
      );
      expect(prismaTransactionMock).not.toHaveBeenCalled();
      expect(getCreditCostsOrThrowMock).not.toHaveBeenCalled();
      expect(getX402ReadySourcesMock).not.toHaveBeenCalled();
      expect(createTaskEventTransactionMock).not.toHaveBeenCalled();
      expect(payX402Mock).not.toHaveBeenCalled();
    });

    it("returns a contextual coworker's actionable collaboration error", async () => {
      const { forbidden } = await import("@/helpers/error");
      requireTaskCollaborationMock.mockRejectedValue(
        forbidden(
          "Parked tasks cannot be modified until vendor workspace access is granted",
          { kind: "task_parked" },
        ),
      );
      const app = createApp({
        ...COWORKER_AGENT_CONTEXT,
        context: { userId: USER_ID, organizationId: null },
      } as AuthenticationContext);

      const response = await postPayment(app, validBody());

      expect(response.status).toBe(403);
      const body = (await response.json()) as {
        message?: string;
        kind?: string;
      };
      expect(body).toMatchObject({
        message:
          "Parked tasks cannot be modified until vendor workspace access is granted",
        kind: "task_parked",
      });
      expect(prismaTransactionMock).not.toHaveBeenCalled();
      expect(getCreditCostsOrThrowMock).not.toHaveBeenCalled();
      expect(getX402ReadySourcesMock).not.toHaveBeenCalled();
      expect(createTaskEventTransactionMock).not.toHaveBeenCalled();
      expect(payX402Mock).not.toHaveBeenCalled();
    });

    it("propagates the collaboration gate rejection without charging", async () => {
      const { forbidden } = await import("@/helpers/error");
      requireTaskCollaborationMock.mockRejectedValue(
        forbidden("You can only act on tasks assigned to your coworker"),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(app, validBody());

      expect(response.status).toBe(403);
      expect(createTaskEventTransactionMock).not.toHaveBeenCalled();
      expect(payX402Mock).not.toHaveBeenCalled();
    });
  });

  describe("request validation", () => {
    it.each([
      ["missing body", undefined, undefined],
      ["missing JSON Content-Type", JSON.stringify(validBody()), undefined],
    ])("rejects %s before any transaction", async (_name, body, headers) => {
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await app.request(
        `http://localhost/${TASK_ID}/x402-payments`,
        { method: "POST", body, headers },
      );

      expect(response.status).toBe(422);
      expect(prismaTransactionMock).not.toHaveBeenCalled();
    });

    it("rejects an idempotencyKey over 200 characters before any transaction", async () => {
      // The key sits inside the [taskId, idempotencyKey] btree unique; an
      // unbounded key would 500 at INSERT time where a 422 belongs.
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(
        app,
        validBody({ idempotencyKey: "k".repeat(201) }),
      );

      expect(response.status).toBe(422);
      expect(prismaTransactionMock).not.toHaveBeenCalled();
    });

    it("rejects an empty idempotencyKey", async () => {
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(
        app,
        validBody({ idempotencyKey: "" }),
      );

      expect(response.status).toBe(422);
      expect(prismaTransactionMock).not.toHaveBeenCalled();
    });

    it.each(["  ", "\t\n", "intent-1\n", " intent-1", "intent-1 "])(
      "rejects a whitespace-only or whitespace-padded idempotencyKey (%j) before any transaction",
      async (idempotencyKey) => {
        // A key that differs from a legit one only by surrounding whitespace
        // sits at a DIFFERENT btree slot, so it would mint a SECOND charge for
        // the same 402 — reject it rather than normalize silently.
        const app = createApp(COWORKER_AGENT_CONTEXT);

        const response = await postPayment(app, validBody({ idempotencyKey }));

        expect(response.status).toBe(422);
        expect(prismaTransactionMock).not.toHaveBeenCalled();
      },
    );

    it("rejects a missing paymentRequired", async () => {
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(app, {
        idempotencyKey: IDEMPOTENCY_KEY,
        agentId: AGENT_ID,
      });

      expect(response.status).toBe(422);
      expect(prismaTransactionMock).not.toHaveBeenCalled();
    });

    it("rejects an unparseable 402 payload with 422 before any charge", async () => {
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(
        app,
        validBody({ paymentRequired: { nonsense: true } }),
      );

      expect(response.status).toBe(422);
      expect(createTaskEventTransactionMock).not.toHaveBeenCalled();
      expect(tx.taskX402Payment.create).not.toHaveBeenCalled();
      expect(payX402Mock).not.toHaveBeenCalled();
    });

    it("rejects an oversized body with 413 before anything parses it", async () => {
      // `X402_MAX_ENCODED_PAYLOAD_LENGTH` bounds only the base64 header
      // dialect. The v1 JSON-body dialect inherits whatever limit the ROUTE
      // sets, and this route set none — Hono parsed the whole body and
      // `stripPrototypePollutingKeys` walked it before any per-field cap
      // applied. Vercel's 4.5 MB platform limit capped production blast
      // radius; a self-hosted `@hono/node-server` has none.
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await app.request(
        `http://localhost/${TASK_ID}/x402-payments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "x".repeat(X402_PAY_MAX_BODY_BYTES + 1),
        },
      );

      expect(response.status).toBe(413);
      expect(prismaTransactionMock).not.toHaveBeenCalled();
      expect(payX402Mock).not.toHaveBeenCalled();
    });

    it("keeps the route body limit in agreement with the masumi header bound", () => {
      // The two are one pair, as X402_MAX_ENCODED_PAYLOAD_LENGTH's own doc
      // says: raising or removing either without the other reopens the
      // asymmetry between the header and body dialects.
      expect(X402_PAY_MAX_BODY_BYTES).toBe(X402_MAX_ENCODED_PAYLOAD_LENGTH);
    });

    it("parses the 402 before opening the serializable transaction", async () => {
      // base64 decode, JSON.parse, the prototype-key sanitizer walk and the
      // BigInt conversions are all attacker-sized work. Running them inside an
      // open SERIALIZABLE transaction holds a snapshot for the length of a
      // payload the caller chose the size of.
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(
        app,
        validBody({ paymentRequired: { nonsense: true } }),
      );

      expect(response.status).toBe(422);
      expect(prismaTransactionMock).not.toHaveBeenCalled();
    });
  });

  describe("charge-transaction conflict surface", () => {
    // Both reads below are effectively configuration. Held inside the
    // SERIALIZABLE charge transaction they made the readiness sync cron and
    // any admin credit-cost edit a serialization-conflict partner for EVERY
    // concurrent payment, turning routine config writes into spurious 409s.
    it("reads x402 readiness outside the charge transaction", async () => {
      const app = createApp(COWORKER_AGENT_CONTEXT);

      await postPayment(app, validBody());

      // No transaction client argument: the read does not join the snapshot.
      expect(getX402ReadySourcesMock).toHaveBeenCalledWith();
      expect(getX402ReadySourcesMock).not.toHaveBeenCalledWith(tx);
    });

    it("reads credit costs outside the charge transaction", async () => {
      const app = createApp(COWORKER_AGENT_CONTEXT);

      await postPayment(app, validBody());

      expect(getCreditCostsOrThrowMock).toHaveBeenCalledWith();
      expect(getCreditCostsOrThrowMock).not.toHaveBeenCalledWith(tx);
    });
  });

  describe("idempotent replay", () => {
    it("returns a VERIFIED record's stored result verbatim without charging or signing", async () => {
      // Terminal rows are immutable, so the preflight read resolves them
      // BEFORE the serializable transaction — the tx never opens.
      preflightPaymentFindUniqueMock.mockResolvedValue(
        createPaymentRecord({
          status: "VERIFIED",
          attemptId: "attempt_stored",
          xPaymentHeader: normalizedPaymentHeader(),
          validBefore: new Date(VALID_BEFORE_SECONDS * 1000),
        }),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(app, validBody());

      expect(response.status, await response.clone().text()).toBe(200);
      const body = (await response.json()) as { data: unknown };
      expect(body.data).toEqual({
        paymentId: PAYMENT_ID,
        attemptId: "attempt_stored",
        paymentHeader: {
          x402Version: 2,
          name: "PAYMENT-SIGNATURE",
          value: normalizedPaymentHeader(),
        },
        caip2Network: BASE_SEPOLIA,
        asset: USDC_ADDRESS,
        amount: "250000",
        payTo: PAY_TO,
      });
      expect(createTaskEventTransactionMock).not.toHaveBeenCalled();
      expect(tx.taskX402Payment.create).not.toHaveBeenCalled();
      expect(payX402Mock).not.toHaveBeenCalled();
      expect(getCreditCostsOrThrowMock).not.toHaveBeenCalled();
      expect(getX402ReadySourcesMock).not.toHaveBeenCalled();
      expect(tx.agent.findFirst).not.toHaveBeenCalled();
    });

    it.each(["FAILED", "REFUNDED"] as const)(
      "answers 409 with the stored coded failureReason for a %s record and never re-charges",
      async (status) => {
        // The original debit was already compensated, and a replay cannot be
        // told apart from a new intent accidentally reusing a key — the key
        // is consumed; the coworker must mint a new one.
        //
        // The reason is a CODE, never the node's raw text: the refusal
        // response deliberately withholds that text (it can carry wallet and
        // budget internals), and this 409 is the one surface that would hand
        // it back on the very next request with the same key.
        tx.taskX402Payment.findUnique.mockResolvedValue(
          createPaymentRecord({
            status,
            failureReason: "node_refused_operational",
          }),
        );
        const app = createApp(COWORKER_AGENT_CONTEXT);

        const response = await postPayment(app, validBody());

        expect(response.status).toBe(409);
        const body = (await response.json()) as { message: string };
        expect(body.message).toContain("node_refused_operational");
        expect(createTaskEventTransactionMock).not.toHaveBeenCalled();
        expect(tx.taskX402Payment.create).not.toHaveBeenCalled();
        expect(payX402Mock).not.toHaveBeenCalled();
      },
    );

    it("re-runs the sign for a PENDING record without a second charge", async () => {
      tx.taskX402Payment.findUnique.mockResolvedValue(createPaymentRecord());
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(app, validBody());

      expect(response.status, await response.clone().text()).toBe(200);
      const body = (await response.json()) as { data: { paymentId: string } };
      expect(body.data.paymentId).toBe(PAYMENT_ID);
      // No second charge, no second record, no second task event.
      expect(createTaskEventTransactionMock).not.toHaveBeenCalled();
      expect(tx.taskX402Payment.create).not.toHaveBeenCalled();
      expect(tx.taskEvent.create).not.toHaveBeenCalled();
      // The sign ran, restricted to the stored verified pair — and narrowed
      // to the single re-verified entry, exactly like the fresh path.
      expect(payX402Mock).toHaveBeenCalledWith(
        expect.objectContaining({
          evmWalletId: "wallet-1",
          preferredNetwork: BASE_SEPOLIA,
          preferredAsset: USDC_ADDRESS,
          paymentRequired: expect.objectContaining({
            accepts: [
              {
                scheme: "exact",
                network: BASE_SEPOLIA,
                asset: USDC_ADDRESS,
                amount: "250000",
                payTo: PAY_TO,
                maxTimeoutSeconds: 60,
                extra: { name: "USDC", version: "2" },
              },
            ],
          }),
        }),
        expect.anything(),
      );
      expect(outerPaymentUpdateManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: PAYMENT_ID, status: "PENDING" },
          data: expect.objectContaining({ status: "VERIFIED" }),
        }),
      );
    });

    it("forwards ONLY the re-verified entry when a PENDING replay re-signs", async () => {
      // The replay twin of the fresh path's narrowing test. A sibling on the
      // STORED pair is refused by the same-pair fence (next test), but one for
      // a DIFFERENT, unregistered asset on the same chain conflicts with
      // nothing — it re-verifies, and without narrowing the whole menu reaches
      // the node, which is only pinned by preferredNetwork/preferredAsset.
      tx.taskX402Payment.findUnique.mockResolvedValue(createPaymentRecord());
      const verified = {
        scheme: "exact",
        network: BASE_SEPOLIA,
        asset: USDC_ADDRESS,
        amount: "250000",
        payTo: PAY_TO,
        maxTimeoutSeconds: 60,
        extra: { name: "USDC", version: "2" },
      };
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(
        app,
        validBody({
          paymentRequired: create402({
            accepts: [
              verified,
              {
                scheme: "exact",
                network: BASE_SEPOLIA,
                asset: "0x9999999999999999999999999999999999999999",
                amount: "999999999",
                payTo: OTHER_PAY_TO,
                maxTimeoutSeconds: 3600,
              },
            ],
          }),
        }),
      );

      expect(response.status).toBe(200);
      const [input] = payX402Mock.mock.calls[0] as [
        { paymentRequired: { accepts: unknown[] } },
      ];
      expect(input.paymentRequired.accepts).toEqual([verified]);
    });

    it("answers 409 for a PENDING replay carrying a poisoned sibling entry on the stored pair, never signing", async () => {
      // The stored (small, legit) entry PLUS a sibling on the SAME
      // (network, asset) pair paying an attacker a huge amount. The node is
      // only pinned by preferredNetwork/preferredAsset, so it could sign the
      // sibling — re-verifying the FULL supplied 402 (same-pair entries must
      // agree) is what refuses this before the node is ever called.
      tx.taskX402Payment.findUnique.mockResolvedValue(createPaymentRecord());
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(
        app,
        validBody({
          paymentRequired: create402({
            accepts: [
              {
                scheme: "exact",
                network: BASE_SEPOLIA,
                asset: USDC_ADDRESS,
                amount: "250000",
                payTo: PAY_TO,
                maxTimeoutSeconds: 60,
              },
              {
                scheme: "exact",
                network: BASE_SEPOLIA,
                asset: USDC_ADDRESS,
                amount: "999999999",
                payTo: OTHER_PAY_TO,
                maxTimeoutSeconds: 60,
              },
            ],
          }),
        }),
      );

      expect(response.status).toBe(409);
      const body = (await response.json()) as { kind?: string };
      expect(body.kind).toBe("x402_payment_key_reused");
      expect(payX402Mock).not.toHaveBeenCalled();
      expect(createTaskEventTransactionMock).not.toHaveBeenCalled();
      expect(tx.taskX402Payment.create).not.toHaveBeenCalled();
      expect(outerPaymentUpdateManyMock).not.toHaveBeenCalled();
    });

    it("answers 409 when a VERIFIED replay names a different agent instead of returning the stored header", async () => {
      // A reused key with a different agentId must never silently re-target: it
      // would hand back a header signed for a different endpoint with a 200.
      tx.taskX402Payment.findUnique.mockResolvedValue(
        createPaymentRecord({
          status: "VERIFIED",
          attemptId: "attempt_stored",
          xPaymentHeader: "c3RvcmVk",
        }),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(
        app,
        validBody({ agentId: "agent_other" }),
      );

      expect(response.status).toBe(409);
      const body = (await response.json()) as { kind?: string };
      expect(body.kind).toBe("x402_payment_key_reused");
      expect(payX402Mock).not.toHaveBeenCalled();
    });

    it("answers 409 when a VERIFIED replay supplies a mismatched 402 instead of returning the stored header", async () => {
      // Same key + same agent but a different demand: the stored header must
      // not be returned for a request that does not verify to the stored tuple.
      tx.taskX402Payment.findUnique.mockResolvedValue(
        createPaymentRecord({
          status: "VERIFIED",
          attemptId: "attempt_stored",
          xPaymentHeader: "c3RvcmVk",
        }),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(
        app,
        validBody({
          paymentRequired: create402({
            accepts: [
              {
                scheme: "exact",
                network: BASE_SEPOLIA,
                asset: USDC_ADDRESS,
                amount: "1",
                payTo: OTHER_PAY_TO,
                maxTimeoutSeconds: 60,
              },
            ],
          }),
        }),
      );

      expect(response.status).toBe(409);
      expect(payX402Mock).not.toHaveBeenCalled();
    });

    it.each([
      [
        "differing payTo",
        {
          scheme: "exact",
          network: BASE_SEPOLIA,
          asset: USDC_ADDRESS,
          amount: "250000",
          payTo: OTHER_PAY_TO,
          maxTimeoutSeconds: 60,
        },
      ],
      [
        "differing network",
        {
          scheme: "exact",
          network: BASE_MAINNET,
          asset: USDC_ADDRESS,
          amount: "250000",
          payTo: PAY_TO,
          maxTimeoutSeconds: 60,
        },
      ],
      [
        "differing asset",
        {
          scheme: "exact",
          network: BASE_SEPOLIA,
          asset: "0x9999999999999999999999999999999999999999",
          amount: "250000",
          payTo: PAY_TO,
          maxTimeoutSeconds: 60,
        },
      ],
    ] as const)(
      "answers 409 for a PENDING replay whose 402 does not verify to the stored tuple (%s), never signing",
      async (_label, entry) => {
        tx.taskX402Payment.findUnique.mockResolvedValue(createPaymentRecord());
        const app = createApp(COWORKER_AGENT_CONTEXT);

        const response = await postPayment(
          app,
          validBody({ paymentRequired: create402({ accepts: [entry] }) }),
        );

        expect(response.status).toBe(409);
        expect(payX402Mock).not.toHaveBeenCalled();
      },
    );

    it("answers 409 when a PENDING replay supplies a different payment demand", async () => {
      tx.taskX402Payment.findUnique.mockResolvedValue(createPaymentRecord());
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(
        app,
        validBody({
          paymentRequired: create402({
            accepts: [
              {
                scheme: "exact",
                network: BASE_SEPOLIA,
                asset: USDC_ADDRESS,
                amount: "999999",
                payTo: PAY_TO,
                maxTimeoutSeconds: 60,
              },
            ],
          }),
        }),
      );

      expect(response.status).toBe(409);
      expect(payX402Mock).not.toHaveBeenCalled();
    });

    it("answers 409 when a PENDING replay names a different agent", async () => {
      tx.taskX402Payment.findUnique.mockResolvedValue(createPaymentRecord());
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(
        app,
        validBody({ agentId: "agent_other" }),
      );

      expect(response.status).toBe(409);
      expect(payX402Mock).not.toHaveBeenCalled();
    });

    it("holds a PENDING replay whose pair went unready: 502 without a false refund promise, and pages ops", async () => {
      // The charge stays PENDING and nothing auto-refunds it yet, so the
      // message must not promise a refund and ops must be paged now.
      tx.taskX402Payment.findUnique.mockResolvedValue(createPaymentRecord());
      getX402ReadySourcesMock.mockResolvedValue([]);
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(app, validBody());

      expect(response.status).toBe(502);
      const body = (await response.json()) as {
        message: string;
        kind?: string;
      };
      expect(body.kind).toBe("x402_pay_pending_held");
      expect(body.message).toContain("held charge stays on a pending record");
      expect(body.message).toContain("SAME idempotencyKey");
      expect(body.message).not.toContain("will be refunded");
      expect(payX402Mock).not.toHaveBeenCalled();
      expect(captureMessageMock).toHaveBeenCalledWith(
        expect.stringContaining("PENDING replay held"),
        expect.objectContaining({
          tags: { error_type: "task_x402_payment_pending_held" },
        }),
      );
    });

    it("refuses a PENDING replay that has exhausted its sign attempts, never re-signing", async () => {
      // A node stuck returning incomplete-200s leaves the record PENDING; an
      // uncapped retry loop would re-sign and burn node budget without bound.
      // Past the cap the replay refuses and directs to support (user funds
      // safe — the held charge is refund-safe).
      tx.taskX402Payment.findUnique.mockResolvedValue(
        createPaymentRecord({ signAttemptCount: 5 }),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(app, validBody());

      expect(response.status).toBe(409);
      const body = (await response.json()) as { kind?: string };
      expect(body.kind).toBe("x402_payment_sign_attempts_exhausted");
      expect(payX402Mock).not.toHaveBeenCalled();
      // No further node attempt reserved: the counter is not bumped past the cap.
      expect(tx.taskX402Payment.update).not.toHaveBeenCalled();
    });

    it("bumps the sign-attempt counter when a PENDING replay re-signs under the cap", async () => {
      tx.taskX402Payment.findUnique.mockResolvedValue(
        createPaymentRecord({ signAttemptCount: 2 }),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(app, validBody());

      expect(response.status).toBe(200);
      // The re-sign is counted — and the sign lease taken — inside the
      // charge-phase transaction, before the node is contacted, so an
      // ambiguous outcome still bounds the next replay and a same-key request
      // arriving mid-call sees the lease.
      expect(tx.taskX402Payment.update).toHaveBeenCalledWith({
        where: { id: PAYMENT_ID },
        data: {
          signAttemptCount: { increment: 1 },
          processingAt: expect.any(Date),
          signRiskExpiresAt: expect.any(Date),
        },
      });
      expect(payX402Mock).toHaveBeenCalled();
    });

    it("refuses a same-key request while another sign is in flight, never calling the node twice", async () => {
      // The interleaving that loses money: R1 (fresh) creates PENDING and
      // calls the node; R2 (same key) takes the PENDING-replay branch and
      // calls the node too. R1's call refuses — R2 consumed the budget — so
      // R1 refunds and closes the row FAILED. R2's call then returns a REAL
      // signed authorization against a row that is already refunded: the
      // credits are back, the row is terminal, and a live EIP-3009
      // authorization Soko signed is discarded. It is unreachable today only
      // because the response body is dropped on the floor.
      //
      // The lease closes the window at its source: only one request may hold
      // a record's sign round-trip, so R2 never reaches the node.
      let releaseR1: (value: unknown) => void = () => {};
      const r1NodeCall = new Promise((resolve) => {
        releaseR1 = resolve;
      });
      let payCalls = 0;
      payX402Mock.mockImplementation(async () => {
        payCalls += 1;
        await r1NodeCall;
        return err({
          kind: "refused",
          status: 402,
          message: "budget exhausted",
        });
      });

      const leaseHeldAt = new Date();
      tx.taskX402Payment.findUnique
        // R1: no record yet — the fresh charge path, which creates one and
        // stamps the lease.
        .mockResolvedValueOnce(null)
        // R2: R1's committed PENDING record, lease still held.
        .mockResolvedValueOnce(
          createPaymentRecord({
            signAttemptCount: 1,
            processingAt: leaseHeldAt,
          }),
        )
        // R1's refund read, after its node call refuses.
        .mockResolvedValueOnce({
          id: PAYMENT_ID,
          transactionId: "txn_1",
          status: "FAILED",
          signAttemptCount: 1,
          refundTransactionId: null,
          processingAt: new Date(),
          signRiskExpiresAt: null,
          taskId: TASK_ID,
          agentId: AGENT_ID,
          amount: "250000",
          asset: USDC_ADDRESS,
          caip2Network: BASE_SEPOLIA,
          transaction: {
            amount: CENTS_FOR_DEMAND * -1n,
            userId: USER_ID,
            organizationId: null,
          },
        });

      const app = createApp(COWORKER_AGENT_CONTEXT);
      const r1 = postPayment(app, validBody());
      // Let R1 commit its charge phase and reach the node before R2 starts.
      while (payCalls === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }

      const r2Response = await postPayment(app, validBody());

      // R2 is turned away cleanly, before any node call and before its
      // sign-attempt counter is spent.
      expect(r2Response.status).toBe(409);
      const r2Body = (await r2Response.json()) as {
        kind?: string;
        message: string;
      };
      expect(r2Body.kind).toBe("x402_payment_key_in_flight");
      // Crucially it must say SAME key: a new key would mint a second charge.
      expect(r2Body.message).toContain("SAME idempotencyKey");
      expect(payCalls).toBe(1);
      expect(tx.taskX402Payment.update).not.toHaveBeenCalled();

      releaseR1(undefined);
      const r1Response = await r1;

      // R1 is unaffected: a provable refusal still refunds synchronously.
      expect(r1Response.status).toBe(502);
      expect(tx.taskX402Payment.updateMany).toHaveBeenCalledWith({
        where: {
          id: PAYMENT_ID,
          status: "PENDING",
          refundTransactionId: null,
          signAttemptCount: 1,
        },
        data: { status: "FAILED", failureReason: "node_refused_operational" },
      });
    });

    it("lets a same-key replay through once the in-flight lease has expired", async () => {
      // The lease is a self-expiring hint, never a lock that can strand a
      // record: a crashed request must not wedge the key forever, so a stale
      // lease is simply taken over.
      tx.taskX402Payment.findUnique.mockResolvedValue(
        createPaymentRecord({
          signAttemptCount: 1,
          processingAt: new Date(Date.now() - 10 * 60 * 1000),
        }),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(app, validBody());

      expect(response.status).toBe(200);
      expect(payX402Mock).toHaveBeenCalled();
      // Taking over the lease re-stamps it and spends an attempt.
      expect(tx.taskX402Payment.update).toHaveBeenCalledWith({
        where: { id: PAYMENT_ID },
        data: {
          signAttemptCount: { increment: 1 },
          processingAt: expect.any(Date),
          signRiskExpiresAt: expect.any(Date),
        },
      });
    });

    it("maps an idempotency-unique insert race to 409", async () => {
      tx.taskX402Payment.create.mockRejectedValue(
        Object.assign(new Error("unique violation"), {
          code: "P2002",
          meta: { target: ["taskId", "idempotencyKey"] },
        }),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(app, validBody());

      expect(response.status).toBe(409);
      expect(payX402Mock).not.toHaveBeenCalled();
    });
  });

  describe("verification before any charge", () => {
    async function expectRejectedBeforeCharge(
      response: Response,
      status: number,
    ) {
      expect(response.status).toBe(status);
      expect(createTaskEventTransactionMock).not.toHaveBeenCalled();
      expect(tx.taskX402Payment.create).not.toHaveBeenCalled();
      expect(tx.taskEvent.create).not.toHaveBeenCalled();
      expect(payX402Mock).not.toHaveBeenCalled();
    }

    it("answers 404 for an unavailable Preprod agent using the catalog gates", async () => {
      tx.agent.findFirst.mockResolvedValue(null);
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(app, validBody());

      await expectRejectedBeforeCharge(response, 404);
      expect(tx.agent.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: AGENT_ID,
            OR: [
              {
                type: "X402",
                x402ResourcesUrl: { not: null },
              },
              {
                type: "OPEN_API",
                openApiSpecUrl: { not: null },
                paymentSources: { some: { scheme: { not: null } } },
              },
            ],
            status: "ONLINE",
          },
        }),
      );
    });

    it("rejects a 402 whose payTo matches no registered source", async () => {
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(
        app,
        validBody({
          paymentRequired: create402({
            accepts: [
              {
                scheme: "exact",
                network: BASE_SEPOLIA,
                asset: USDC_ADDRESS,
                amount: "250000",
                payTo: OTHER_PAY_TO,
                maxTimeoutSeconds: 60,
              },
            ],
          }),
        }),
      );

      await expectRejectedBeforeCharge(response, 422);
    });

    it("rejects a registered network outside the per-environment allowlist", async () => {
      // Base mainnet is registered AND demanded, but the deployment is Preprod.
      tx.agent.findFirst.mockResolvedValue(
        createAgentRow({
          paymentSources: [
            {
              sourceIndex: 0,
              network: BASE_MAINNET,
              payTo: PAY_TO,
              scheme: "exact",
              pricingType: "FIXED",
              amounts: [{ unit: USDC_ADDRESS, amount: 250000n, decimals: 6 }],
            },
          ],
        }),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(
        app,
        validBody({
          paymentRequired: create402({
            accepts: [
              {
                scheme: "exact",
                network: BASE_MAINNET,
                asset: USDC_ADDRESS,
                amount: "250000",
                payTo: PAY_TO,
                maxTimeoutSeconds: 60,
              },
            ],
          }),
        }),
      );

      await expectRejectedBeforeCharge(response, 422);
    });

    it("rejects a demand above the agent's advertised price", async () => {
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(
        app,
        validBody({
          paymentRequired: create402({
            accepts: [
              {
                scheme: "exact",
                network: BASE_SEPOLIA,
                asset: USDC_ADDRESS,
                amount: "250001",
                payTo: PAY_TO,
                maxTimeoutSeconds: 60,
              },
            ],
          }),
        }),
      );

      await expectRejectedBeforeCharge(response, 422);
    });

    it("rejects when the (network, asset) pair is not buy-side ready", async () => {
      getX402ReadySourcesMock.mockResolvedValue([]);
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(app, validBody());

      await expectRejectedBeforeCharge(response, 422);
    });

    it("does not let a remembered agent id bypass per-agent listing gates", async () => {
      tx.agent.findFirst.mockResolvedValue(
        createAgentRow({
          paymentSources: [
            {
              sourceIndex: 0,
              network: BASE_SEPOLIA,
              payTo: PAY_TO,
              scheme: "exact",
              pricingType: "DYNAMIC",
              amounts: [],
            },
            {
              sourceIndex: 1,
              network: BASE_SEPOLIA,
              payTo: "not-an-address",
              scheme: "exact",
              pricingType: "DYNAMIC",
              amounts: [],
            },
          ],
        }),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(app, validBody({ maxCredits: 1 }));

      await expectRejectedBeforeCharge(response, 422);
      expect(payX402Mock).not.toHaveBeenCalled();
    });

    it("pays a fixed demand from an agent with mixed pricing sources", async () => {
      tx.agent.findFirst.mockResolvedValue(
        createAgentRow({
          paymentSources: [
            {
              sourceIndex: 0,
              network: BASE_SEPOLIA,
              payTo: PAY_TO,
              scheme: "exact",
              pricingType: "DYNAMIC",
              amounts: [],
            },
            {
              sourceIndex: 1,
              network: BASE_SEPOLIA,
              payTo: PAY_TO,
              scheme: "exact",
              pricingType: "FIXED",
              amounts: [{ unit: USDC_ADDRESS, amount: 250000n, decimals: 6 }],
            },
          ],
        }),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(app, validBody());

      expect(response.status).toBe(200);
      expect(createTaskEventTransactionMock).toHaveBeenCalledTimes(1);
      expect(payX402Mock).toHaveBeenCalledTimes(1);
    });

    it("rejects an unknown exact-EVM asset domain before any charge", async () => {
      // The 402 is attacker-authored and the matcher takes the FIRST accepts
      // entry matching ANY registered source, so a listed agent with two
      // registered sources can order its accepts expensive-first. Both entries
      // pass `demanded <= advertised` — each is checked against its OWN source
      // row — so the coworker that wanted the cheap resource is charged the
      // expensive one. maxCredits is the caller's own ceiling on that.
      tx.agent.findFirst.mockResolvedValue(
        createAgentRow({
          paymentSources: [
            {
              sourceIndex: 0,
              network: BASE_SEPOLIA,
              payTo: PAY_TO,
              scheme: "exact",
              pricingType: "FIXED",
              amounts: [{ unit: USDC_ADDRESS, amount: 250000n, decimals: 6 }],
            },
            {
              sourceIndex: 1,
              network: BASE_SEPOLIA,
              payTo: OTHER_PAY_TO,
              scheme: "exact",
              pricingType: "FIXED",
              amounts: [
                { unit: EXPENSIVE_ASSET, amount: 999999999n, decimals: 6 },
              ],
            },
          ],
        }),
      );
      getCreditCostsOrThrowMock.mockResolvedValue([
        createCreditCostRow(
          `${BASE_SEPOLIA}/erc20:${USDC_ADDRESS}`,
          2n * 10n ** 10n,
        ),
        createCreditCostRow(
          `${BASE_SEPOLIA}/erc20:${EXPENSIVE_ASSET}`,
          2n * 10n ** 10n,
        ),
      ]);
      getX402ReadySourcesMock.mockResolvedValue([
        {
          caip2Network: BASE_SEPOLIA,
          asset: USDC_ADDRESS,
          evmWalletId: "wallet-1",
          evmWalletAddress: PAYER,
          decimals: 6,
        },
        {
          caip2Network: BASE_SEPOLIA,
          asset: EXPENSIVE_ASSET,
          evmWalletId: "wallet-1",
          evmWalletAddress: PAYER,
          decimals: 6,
        },
      ]);
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(
        app,
        validBody({
          maxCredits: 1,
          paymentRequired: create402({
            accepts: [
              {
                scheme: "exact",
                network: BASE_SEPOLIA,
                asset: EXPENSIVE_ASSET,
                amount: "999999999",
                payTo: OTHER_PAY_TO,
                maxTimeoutSeconds: 60,
                extra: { name: "Unknown Token", version: "1" },
              },
              {
                scheme: "exact",
                network: BASE_SEPOLIA,
                asset: USDC_ADDRESS,
                amount: "250000",
                payTo: PAY_TO,
                maxTimeoutSeconds: 60,
                extra: { name: "USDC", version: "2" },
              },
            ],
          }),
        }),
      );

      await expectRejectedBeforeCharge(response, 422);
      const body = (await response.json()) as { message: string };
      expect(body.message).toContain("trusted EIP-712 domain");
    });

    it("charges a demand priced exactly at maxCredits", async () => {
      // The fence is a ceiling, not a strict inequality: the demand this test
      // sends prices at exactly 0.5 credits.
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(app, validBody({ maxCredits: 0.5 }));

      expect(response.status).toBe(200);
      expect(createTaskEventTransactionMock).toHaveBeenCalledWith(
        expect.objectContaining({ cents: CENTS_FOR_DEMAND }),
      );
    });

    it("charges a dynamic runtime quote when it is within mandatory maxCredits", async () => {
      tx.agent.findFirst.mockResolvedValue(
        createAgentRow({
          paymentSources: [
            {
              sourceIndex: 0,
              network: BASE_SEPOLIA,
              payTo: PAY_TO,
              scheme: "exact",
              pricingType: "DYNAMIC",
              amounts: [],
            },
          ],
        }),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(app, validBody({ maxCredits: 0.5 }));

      expect(response.status).toBe(200);
      expect(createTaskEventTransactionMock).toHaveBeenCalledWith(
        expect.objectContaining({ cents: CENTS_FOR_DEMAND }),
      );
      expect(payX402Mock).toHaveBeenCalledTimes(1);
    });

    it("requires maxCredits for a fresh dynamic runtime quote before charging", async () => {
      tx.agent.findFirst.mockResolvedValue(
        createAgentRow({
          paymentSources: [
            {
              sourceIndex: 0,
              network: BASE_SEPOLIA,
              payTo: PAY_TO,
              scheme: "exact",
              pricingType: "DYNAMIC",
              amounts: [],
            },
          ],
        }),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(app, validBody());

      await expectRejectedBeforeCharge(response, 400);
      const body = (await response.json()) as { message: string };
      expect(body.message).toContain("maxCredits is required");
    });

    it("rejects a dynamic runtime quote above maxCredits before charging", async () => {
      tx.agent.findFirst.mockResolvedValue(
        createAgentRow({
          paymentSources: [
            {
              sourceIndex: 0,
              network: BASE_SEPOLIA,
              payTo: PAY_TO,
              scheme: "exact",
              pricingType: "DYNAMIC",
              amounts: [],
            },
          ],
        }),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(app, validBody({ maxCredits: 0.49 }));

      await expectRejectedBeforeCharge(response, 400);
      const body = (await response.json()) as { message: string };
      expect(body.message).toContain("above the maxCredits");
    });

    it.each([0, -1])(
      "rejects a non-positive maxCredits (%j) before any transaction",
      async (maxCredits) => {
        const app = createApp(COWORKER_AGENT_CONTEXT);

        const response = await postPayment(app, validBody({ maxCredits }));

        expect(response.status).toBe(422);
        expect(prismaTransactionMock).not.toHaveBeenCalled();
      },
    );

    it("prices off the node's decimals, not the agent-registered value", async () => {
      // `decimals` scales the charge INVERSELY, and the registry copy sits on
      // the agent's OWN entry. An agent registering USDC (true value 6) as 18 divides
      // its own charge by 10^12 — flooring it at MIN_CHARGEABLE_CREDITS —
      // while Soko's managed wallet signs away a real USDC. The ceiling check
      // cannot see it either: that compares the demand against the same
      // agent-registered amount.
      tx.agent.findFirst.mockResolvedValue(
        createAgentRow({
          paymentSources: [
            {
              sourceIndex: 0,
              network: BASE_SEPOLIA,
              payTo: PAY_TO,
              scheme: "exact",
              pricingType: "FIXED",
              amounts: [{ unit: USDC_ADDRESS, amount: 250000n, decimals: 18 }],
            },
          ],
        }),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(app, validBody());

      expect(response.status).toBe(200);
      expect(createTaskEventTransactionMock).toHaveBeenCalledWith(
        expect.objectContaining({ cents: CENTS_FOR_DEMAND }),
      );
    });

    it("rejects when the asset has no CreditCost row (fail closed)", async () => {
      getCreditCostsOrThrowMock.mockResolvedValue([
        createCreditCostRow("some-other-unit", 10n ** 10n),
      ]);
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(app, validBody());

      await expectRejectedBeforeCharge(response, 422);
    });
  });

  describe("happy path", () => {
    it("normalizes a v1 demand and returns an X-PAYMENT replay header", async () => {
      payX402Mock.mockResolvedValue(
        ok(signedNodePayment({ xPaymentHeader: xPaymentHeaderV1() })),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);
      const paymentRequired = {
        x402Version: 1,
        accepts: [
          {
            scheme: "exact",
            network: "base-sepolia",
            asset: USDC_ADDRESS,
            maxAmountRequired: "250000",
            payTo: PAY_TO,
            maxTimeoutSeconds: 60,
            extra: { name: "USDC", version: "2" },
          },
        ],
      };

      const response = await postPayment(app, validBody({ paymentRequired }));

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        data: {
          paymentHeader: { x402Version: number; name: string; value: string };
        };
      };
      expect(body.data).toMatchObject({
        paymentHeader: {
          x402Version: 1,
          name: "X-PAYMENT",
          value: xPaymentHeaderV1(),
        },
      });
      expect(body.data).not.toHaveProperty("xPaymentHeader");
      expect(payX402Mock).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentRequired: expect.objectContaining({
            x402Version: 1,
            accepts: [
              expect.objectContaining({
                network: BASE_SEPOLIA,
                amount: "250000",
              }),
            ],
          }),
        }),
        expect.anything(),
      );
    });

    it("charges, records, signs, verifies, and returns the header", async () => {
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(app, validBody());

      expect(response.status).toBe(200);
      const body = (await response.json()) as { data: unknown };
      expect(body.data).toEqual({
        paymentId: PAYMENT_ID,
        attemptId: "attempt_1",
        paymentHeader: {
          x402Version: 2,
          name: "PAYMENT-SIGNATURE",
          value: normalizedPaymentHeader(),
        },
        caip2Network: BASE_SEPOLIA,
        asset: USDC_ADDRESS,
        amount: "250000",
        payTo: PAY_TO,
      });

      // Charge: the exact floored CAIP-19 conversion, from the task owner.
      expect(createTaskEventTransactionMock).toHaveBeenCalledWith({
        userId: USER_ID,
        organizationId: null,
        cents: CENTS_FOR_DEMAND,
        tx,
      });
      // Credit-bearing task event, like the masumiPayment charge.
      expect(tx.taskEvent.create).toHaveBeenCalledWith({
        data: {
          taskId: TASK_ID,
          cents: CENTS_FOR_DEMAND,
          transactionId: "txn_1",
          coworkerId: COWORKER_ID,
        },
      });
      // PENDING record with the verified tuple, debit, and event in ONE
      // transaction.
      expect(tx.taskX402Payment.create).toHaveBeenCalledWith({
        data: {
          idempotencyKey: IDEMPOTENCY_KEY,
          taskId: TASK_ID,
          agentId: AGENT_ID,
          caip2Network: BASE_SEPOLIA,
          asset: USDC_ADDRESS,
          amount: "250000",
          payTo: PAY_TO,
          demandFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
          taskEventId: "evt_charge_1",
          transactionId: "txn_1",
          // The first node sign call is counted at creation (L3 cap)...
          signAttemptCount: 1,
          // ...and holds the sign lease, so a same-key request arriving while
          // this one is at the node is refused instead of racing it.
          processingAt: expect.any(Date),
          // Conservative authorization lifetime persists before the node call.
          signRiskExpiresAt: expect.any(Date),
        },
        select: { id: true },
      });
      // Sign restricted to the verified pair with Soko's wallet.
      expect(payX402Mock).toHaveBeenCalledWith(
        {
          evmWalletId: "wallet-1",
          paymentRequired: expect.objectContaining({ x402Version: 2 }),
          preferredNetwork: BASE_SEPOLIA,
          preferredAsset: USDC_ADDRESS,
          paymentIdentifier: `${TASK_ID}_${PAYMENT_ID}`,
        },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      // The node rejects any paymentIdentifier outside ^[a-zA-Z0-9_-]+$ with a
      // 400 (payment.openapi.json) — which this flow would treat as a refusal
      // and refund. Assert the CHARACTER class the value we send satisfies (a
      // ":" separator would not), so the node contract can't regress behind
      // the mocked client. The 16–128 length bound is a production property of
      // the uuid(7) task/payment ids, not of these short test fixtures.
      const sentIdentifier = payX402Mock.mock.calls[0]?.[0]?.paymentIdentifier;
      expect(sentIdentifier).toMatch(/^[a-zA-Z0-9_-]+$/);
      // VERIFIED with the signed tuple and the phased-settlement observation
      // fields (ticket 011 Q3).
      expect(outerPaymentUpdateManyMock).toHaveBeenCalledWith({
        where: { id: PAYMENT_ID, status: "PENDING" },
        data: {
          status: "VERIFIED",
          attemptId: "attempt_1",
          xPaymentHeader: normalizedPaymentHeader(),
          caip2Network: BASE_SEPOLIA,
          asset: USDC_ADDRESS,
          amount: "250000",
          payTo: PAY_TO,
          payerAddress: PAYER,
          paymentPayloadHash: "0xhash",
          // Sourced from the signed header, not from the node's sibling
          // `paymentPayload` rendering of it.
          payloadNonce: PAYLOAD_NONCE,
          validBefore: new Date(VALID_BEFORE_SECONDS * 1000),
          signRiskExpiresAt: new Date(VALID_BEFORE_SECONDS * 1000),
          failureReason: null,
        },
      });
      // The committed charge event is published to the task stream.
      await Promise.all(waitUntilCapturedPromises);
      expect(publishTaskEventDataMock).toHaveBeenCalledWith({
        userId: USER_ID,
        taskId: TASK_ID,
        eventType: "task_event",
      });
    });

    it("holds PENDING when the signed nonce or expiry is malformed", async () => {
      payX402Mock.mockResolvedValue(
        ok(
          signedNodePayment({
            xPaymentHeader: xPaymentHeader({
              nonce: "",
              validBefore: "not-a-number",
            }),
          }),
        ),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(app, validBody());

      expect(response.status).toBe(502);
      const body = (await response.json()) as { kind?: string };
      expect(body.kind).toBe("x402_pay_outcome_unknown");
      expect(outerPaymentUpdateManyMock).not.toHaveBeenCalled();
    });

    it("withholds the node call when dispatch stalls past the fence budget", async () => {
      // Both persisted fences were stamped from `signStartedAt` inside the
      // charge transaction; the node call happens after commit. If that gap
      // ate the slack the fences budget, a sign could outlive
      // `signRiskExpiresAt` — so the service refuses to dispatch at all.
      vi.useFakeTimers();
      try {
        prismaTransactionMock.mockImplementation(
          async (callback: (tx: TxMock) => unknown) => {
            const result = await callback(tx);
            // Stall AFTER the commit, before the dispatch check.
            vi.setSystemTime(
              Date.now() + TASK_X402_MAX_SIGN_DISPATCH_DELAY_MS + 1,
            );
            return result;
          },
        );
        const app = createApp(COWORKER_AGENT_CONTEXT);

        const response = await postPayment(app, validBody());

        expect(response.status).toBe(502);
        const body = (await response.json()) as { kind?: string };
        expect(body.kind).toBe("x402_pay_outcome_unknown");
        // The whole point: no node call, so no header can exist anywhere.
        expect(payX402Mock).not.toHaveBeenCalled();
        // The record stays PENDING for the same-key replay to re-fence.
        expect(outerPaymentUpdateManyMock).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("dispatches normally when the commit-to-dispatch gap is within budget", async () => {
      vi.useFakeTimers();
      try {
        prismaTransactionMock.mockImplementation(
          async (callback: (tx: TxMock) => unknown) => {
            const result = await callback(tx);
            vi.setSystemTime(
              Date.now() + TASK_X402_MAX_SIGN_DISPATCH_DELAY_MS - 1000,
            );
            return result;
          },
        );
        const app = createApp(COWORKER_AGENT_CONTEXT);

        const response = await postPayment(app, validBody());

        expect(response.status, await response.clone().text()).toBe(200);
        expect(payX402Mock).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("accepts a node amount that differs only by leading zeros", async () => {
      // The node spec types `amount` as ^\d+$, which permits "0250000". A raw
      // string compare against the charged "250000" would call that a
      // mismatch: 502, charge stranded PENDING, and a header Soko paid for
      // thrown away. Base units are numbers — compare them as numbers.
      payX402Mock.mockResolvedValue(
        ok(signedNodePayment({ amount: "0250000" })),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(app, validBody());

      expect(response.status).toBe(200);
      expect(outerPaymentUpdateManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "VERIFIED" }),
        }),
      );
    });

    it("stores the payer canonically, so checksum casing cannot defeat the nonce-replay unique", async () => {
      // `@@unique([caip2Network, asset, payerAddress, payloadNonce])` is a BYTE
      // comparison, and it is the mirror of the chain's own guarantee that one
      // (payer, nonce) authorization settles exactly once. An EIP-55
      // checksummed payer and its lowercase twin land on different index keys,
      // so two records behind ONE settleable transfer would both insert — two
      // credit debits, one transfer. `caip2Network` and `asset` in the same
      // write are already lowercased; the payer was the odd one out, even
      // though the canonical value is in scope (the assert just compared
      // `authorization.from` against `signed.payer.toLowerCase()`).
      const checksummedPayer = PAYER.toUpperCase().replace("0X", "0x");
      expect(checksummedPayer.toLowerCase()).toBe(PAYER);
      payX402Mock.mockResolvedValue(
        ok(signedNodePayment({ payer: checksummedPayer })),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(app, validBody());

      expect(response.status).toBe(200);
      expect(outerPaymentUpdateManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ payerAddress: PAYER }),
        }),
      );
    });

    it("stores the CHARGED payTo spelling, not the node's casing", async () => {
      // The PENDING insert stored the canonical lowercase payTo from the
      // verified demand, and the summary assert only proves the node's
      // spelling matches case-insensitively. Writing `signed.payTo` at
      // finalize would de-canonicalize the column with node-influenced
      // casing — the exact one-layer-down dependency on downstream
      // `.toLowerCase()` guards the 402 path already removed for payTo.
      const checksummedPayTo = PAY_TO.toUpperCase().replace("0X", "0x");
      expect(checksummedPayTo.toLowerCase()).toBe(PAY_TO);
      payX402Mock.mockResolvedValue(
        ok(signedNodePayment({ payTo: checksummedPayTo })),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(app, validBody());

      expect(response.status).toBe(200);
      expect(outerPaymentUpdateManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ payTo: PAY_TO }),
        }),
      );
    });

    it("stores the CHARGED amount spelling when the node pads it, keeping the key replayable", async () => {
      // "0250000" is a legal node spelling of the charged "250000" (the node
      // spec types `amount` as ^\d+$), and the BigInt compare above rightly
      // accepts it. Storing that spelling is the harm: the replay compares the
      // stored column as a STRING, so the exact case idempotency exists for —
      // the 200 lost in transit — answers 409 "use a new idempotencyKey" for a
      // header the coworker already paid for, and following that advice mints
      // a SECOND debit.
      payX402Mock.mockResolvedValue(
        ok(signedNodePayment({ amount: "0250000" })),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const first = await postPayment(app, validBody());

      expect(first.status).toBe(200);
      const stored = outerPaymentUpdateManyMock.mock.calls[0]?.[0]?.data as {
        amount: string;
      };
      expect(stored.amount).toBe("250000");

      // The row that spelling produced must still be reachable by the SAME key.
      tx.taskX402Payment.findUnique.mockResolvedValue(
        createPaymentRecord({
          status: "VERIFIED",
          attemptId: "attempt_1",
          xPaymentHeader: xPaymentHeader(),
          validBefore: new Date(VALID_BEFORE_SECONDS * 1000),
          amount: stored.amount,
        }),
      );

      const replay = await postPayment(app, validBody());

      expect(replay.status).toBe(200);
      const body = (await replay.json()) as {
        data: { paymentHeader: { value: string } };
      };
      expect(body.data.paymentHeader.value).toBe(xPaymentHeader());
    });

    it("keeps a padded 402 amount replayable too — the stored spelling is the charged one", async () => {
      // The mirror of the case above, and the reason the fix is "store what was
      // charged" rather than "store the canonical BigInt": `normalizeAmount`
      // passes an amount through VERBATIM, so a 402 carrying "0250000" charges
      // and creates the row with that spelling. Re-canonicalizing at finalize
      // would rewrite the column out from under the replay's string compare and
      // strand the key from the other direction.
      const paddedDemand = create402({
        accepts: [
          {
            scheme: "exact",
            network: BASE_SEPOLIA,
            asset: USDC_ADDRESS,
            amount: "0250000",
            payTo: PAY_TO,
            maxTimeoutSeconds: 60,
            extra: { name: "USDC", version: "2" },
          },
        ],
      });
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const first = await postPayment(
        app,
        validBody({ paymentRequired: paddedDemand }),
      );

      expect(first.status).toBe(200);
      // The row was CREATED with the 402's own spelling...
      expect(tx.taskX402Payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amount: "0250000" }),
        }),
      );
      // ...so finalize must not rewrite it to a different one.
      const stored = outerPaymentUpdateManyMock.mock.calls[0]?.[0]?.data as {
        amount: string;
      };
      expect(stored.amount).toBe("0250000");

      tx.taskX402Payment.findUnique.mockResolvedValue(
        createPaymentRecord({
          status: "VERIFIED",
          attemptId: "attempt_1",
          xPaymentHeader: xPaymentHeader(),
          validBefore: new Date(VALID_BEFORE_SECONDS * 1000),
          amount: stored.amount,
          demandFingerprint: paymentDemandFingerprint(paddedDemand),
        }),
      );

      const replay = await postPayment(
        app,
        validBody({ paymentRequired: paddedDemand }),
      );

      expect(replay.status).toBe(200);
    });

    it("forwards ONLY the verified accepts entry to the node", async () => {
      // The node receives the whole paymentRequired and decides which entry it
      // signs; nothing node-side constrains payTo. The same-pair agreement
      // fence and preferredNetwork/preferredAsset narrow that, but an entry
      // for a DIFFERENT asset on the same chain meets neither — it is filtered
      // only if the node honours preferredAsset, a fail-open dependency on a
      // node this repo does not deploy. Handing over one entry makes the
      // node's selection rule irrelevant.
      const verified = {
        scheme: "exact",
        network: BASE_SEPOLIA,
        asset: USDC_ADDRESS,
        amount: "250000",
        payTo: PAY_TO,
        maxTimeoutSeconds: 60,
        extra: { name: "USDC", version: "2" },
      };
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(
        app,
        validBody({
          paymentRequired: create402({
            accepts: [
              verified,
              {
                scheme: "exact",
                network: BASE_SEPOLIA,
                asset: "0x9999999999999999999999999999999999999999",
                amount: "999999999",
                payTo: OTHER_PAY_TO,
                maxTimeoutSeconds: 3600,
              },
            ],
          }),
        }),
      );

      expect(response.status).toBe(200);
      const [input] = payX402Mock.mock.calls[0] as [
        { paymentRequired: { accepts: unknown[] } },
      ];
      expect(input.paymentRequired.accepts).toEqual([verified]);
    });

    it("omits paymentIdentifier when the 402 does not advertise the extension", async () => {
      // The node 400s an identifier sent against a 402 without the extension
      // (ticket 011 Q2) — AFTER the charge, forcing a pointless refund cycle.
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(
        app,
        validBody({ paymentRequired: create402({ extensions: undefined }) }),
      );

      expect(response.status).toBe(200);
      const [input] = payX402Mock.mock.calls[0] as [Record<string, unknown>];
      expect("paymentIdentifier" in input).toBe(false);
    });
  });

  describe("node refusal — charge then refund", () => {
    beforeEach(() => {
      // Refund transaction reads the record after claiming FAILED: first
      // findUnique call is the idempotency probe (null), second the refund
      // read.
      tx.taskX402Payment.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: PAYMENT_ID,
          status: "FAILED",
          refundTransactionId: null,
          transaction: {
            amount: CENTS_FOR_DEMAND * -1n,
            userId: USER_ID,
            organizationId: null,
          },
        });
    });

    it("refunds synchronously, marks FAILED, and answers 502 for a budget refusal", async () => {
      payX402Mock.mockResolvedValue(
        err({ kind: "refused", status: 402, message: "budget exhausted" }),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(app, validBody());

      expect(response.status).toBe(502);
      const body = (await response.json()) as { message: string };
      // The raw node detail (may carry wallet/budget internals) is NOT leaked
      // to the coworker on an operational (402/500) refusal — only a generic
      // message; the detail is retained in the Sentry capture.
      expect(body.message).not.toContain("budget exhausted");
      expect(body.message).toContain("operational error");
      expect(body.message).not.toContain(xPaymentHeader());
      expect(captureMessageMock).toHaveBeenCalledWith(
        "x402 payment refused by the payment node",
        expect.objectContaining({
          extra: expect.objectContaining({
            reason: expect.stringContaining("budget exhausted"),
          }),
        }),
      );

      // The charge happened, then the compensating transaction restored it.
      expect(createTaskEventTransactionMock).toHaveBeenCalled();
      // A CODE, not the node's raw text. The 502 above withholds that text
      // because it can carry wallet/budget internals — persisting it would
      // hand it straight back through the consumed-key 409 on the next
      // request with the same idempotencyKey, defeating the control with one
      // extra call. The raw text lives only in the Sentry capture.
      expect(tx.taskX402Payment.updateMany).toHaveBeenCalledWith({
        where: {
          id: PAYMENT_ID,
          status: "PENDING",
          refundTransactionId: null,
          signAttemptCount: 1,
        },
        data: {
          status: "FAILED",
          failureReason: "node_refused_operational",
        },
      });
      expect(tx.taskX402Payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: PAYMENT_ID },
          data: expect.objectContaining({
            // Labelled at the mint: this refund is the AUTOMATED node-refusal
            // one, never an operator quality signal in the admin rollup.
            refundKind: "NODE_REFUSAL",
            refundTransaction: {
              create: expect.objectContaining({
                amount: CENTS_FOR_DEMAND,
                sourceCreditBucket: {
                  create: expect.objectContaining({
                    amount: CENTS_FOR_DEMAND,
                    referenceId: `task-x402-payment:${PAYMENT_ID}`,
                    referenceType: "REFUND",
                    expiresAt: null,
                  }),
                },
              }),
            },
          }),
        }),
      );
      // Never marked VERIFIED.
      expect(outerPaymentUpdateManyMock).not.toHaveBeenCalled();
    });

    it("holds the record PENDING and pages when the refusal refund itself fails", async () => {
      // The refusal is real but the compensating refund (a DB write) throws.
      // The refusal must still be captured, the record must NOT be reported as
      // refunded (that would tell the coworker to reuse a key and double-charge
      // the stuck charge), and the outcome is the held-pending 502.
      payX402Mock.mockResolvedValue(
        err({ kind: "refused", status: 402, message: "budget exhausted" }),
      );
      // First $transaction = the charge phase (runs normally). Second = the
      // refund (throws).
      prismaTransactionMock
        .mockImplementationOnce(
          async (callback: (tx: TxMock) => unknown) => await callback(tx),
        )
        .mockImplementationOnce(async () => {
          throw new Error("refund db down");
        });
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(app, validBody());

      expect(response.status).toBe(502);
      const body = (await response.json()) as {
        message: string;
        kind?: string;
      };
      expect(body.message).toContain("pending record");
      expect(body.message).toContain("SAME idempotencyKey");
      expect(body.message).not.toContain("Credits were refunded");
      // Refusal captured FIRST (before the failing refund), and the refund
      // failure captured separately.
      expect(captureMessageMock).toHaveBeenCalledWith(
        "x402 payment refused by the payment node",
        expect.anything(),
      );
      expect(captureExceptionMock).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          tags: { error_type: "task_x402_payment_refund_failed" },
        }),
      );
      expect(outerPaymentUpdateManyMock).not.toHaveBeenCalled();
    });

    it("maps a deterministic 400 pre-sign rejection to 422 after refunding", async () => {
      payX402Mock.mockResolvedValue(
        err({
          kind: "refused",
          status: 400,
          message: "x402 pay refused (status 400): requirements drift",
          nodeMessage: "requirements drift",
        }),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(app, validBody());

      expect(response.status).toBe(422);
      // A 400 is the coworker's own payload fault, so its message stays
      // verbose — the node detail helps them fix the 402 they forwarded.
      const body = (await response.json()) as { message: string };
      expect(body.message).toContain("requirements drift");
      // The PERSISTED reason is still a code: the stored value is replayed
      // through the consumed-key 409, and the classifier — not the branch
      // that happens to answer verbosely once — decides what is durable.
      expect(tx.taskX402Payment.updateMany).toHaveBeenCalledWith({
        where: {
          id: PAYMENT_ID,
          status: "PENDING",
          refundTransactionId: null,
          signAttemptCount: 1,
        },
        data: { status: "FAILED", failureReason: "node_refused_payload" },
      });
      expect(tx.taskX402Payment.update).toHaveBeenCalled();
    });

    it("never echoes a 400 whose text came from the whole-body JSON dump", async () => {
      // The 400 branch is verbose on purpose, but it interpolated
      // `signResult.error.message` — which is built on
      // `extractNodeErrorMessage`, whose fallback is a JSON.stringify of the
      // ENTIRE node response body. So a node 400 carrying wallet or budget
      // internals leaked exactly what the 402/500 sibling a few lines down
      // deliberately withholds. Only the node's own `error.message` may be
      // repeated; with no envelope there is nothing safe to say.
      payX402Mock.mockResolvedValue(
        err({
          kind: "refused",
          status: 400,
          message:
            'x402 pay refused (status 400): {"evmWalletId":"wallet-secret","remainingBudget":"41337"}',
        }),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(app, validBody());

      expect(response.status).toBe(422);
      const body = (await response.json()) as { message: string };
      expect(body.message).not.toContain("wallet-secret");
      expect(body.message).not.toContain("41337");
      // Still actionable: the coworker learns the payload was rejected and
      // what to do next, just not the node's internals.
      expect(body.message).toContain("re-fetch the 402");
    });

    it("bounds how much of a node 400 reaches the response body", async () => {
      const enormous = "x".repeat(50_000);
      payX402Mock.mockResolvedValue(
        err({
          kind: "refused",
          status: 400,
          message: `x402 pay refused (status 400): ${enormous}`,
          nodeMessage: enormous,
        }),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(app, validBody());

      const body = (await response.json()) as { message: string };
      expect(body.message.length).toBeLessThan(enormous.length);
    });
  });

  describe("ambiguous sign outcome", () => {
    it("answers 502, leaves the record PENDING, and never refunds inline", async () => {
      payX402Mock.mockResolvedValue(
        err({ kind: "ambiguous", message: "socket hang up" }),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(app, validBody());

      expect(response.status).toBe(502);
      const body = (await response.json()) as { message: string };
      expect(body.message).toContain("SAME idempotencyKey");
      // The record was created PENDING and stays that way: no FAILED update,
      // no refund, no VERIFIED.
      expect(tx.taskX402Payment.create).toHaveBeenCalled();
      expect(tx.taskX402Payment.updateMany).not.toHaveBeenCalled();
      expect(tx.taskX402Payment.update).not.toHaveBeenCalled();
      expect(outerPaymentUpdateManyMock).not.toHaveBeenCalled();
    });

    it("keeps PENDING when a lease-expired replay is refused after an ambiguous first attempt", async () => {
      payX402Mock
        .mockResolvedValueOnce(
          err({ kind: "ambiguous", message: "first response lost" }),
        )
        .mockResolvedValueOnce(
          err({ kind: "refused", status: 402, message: "budget exhausted" }),
        );
      tx.taskX402Payment.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(
          createPaymentRecord({
            signAttemptCount: 1,
            processingAt: new Date(Date.now() - 10 * 60 * 1_000),
          }),
        );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const first = await postPayment(app, validBody());
      const replay = await postPayment(app, validBody());

      expect(first.status).toBe(502);
      expect(replay.status).toBe(502);
      const body = (await replay.json()) as { kind?: string; message: string };
      expect(body.kind).toBe("x402_pay_outcome_unknown");
      expect(body.message).toContain("earlier sign attempt");
      expect(body.message).toContain("pending record");
      expect(tx.taskX402Payment.updateMany).not.toHaveBeenCalled();
      expect(
        tx.taskX402Payment.update.mock.calls.some(
          ([args]) =>
            typeof args === "object" &&
            args !== null &&
            "data" in args &&
            typeof args.data === "object" &&
            args.data !== null &&
            "refundTransaction" in args.data,
        ),
      ).toBe(false);
      expect(captureMessageMock).toHaveBeenCalledWith(
        "x402 replay refusal held behind earlier sign-risk window",
        expect.objectContaining({
          tags: { error_type: "task_x402_payment_replay_refusal_held" },
        }),
      );
    });

    it("withholds the raw node message from the 502 and keeps it in the capture", async () => {
      // The refusal branch deliberately withholds exactly this ("can carry
      // wallet/budget internals"), and `extractNodeErrorMessage` falls back to
      // JSON.stringify of the whole node response body — so the ambiguous
      // branch was the one sanitized answer that echoed it. One-shot and
      // unpersisted, but the control is the same control.
      const leaky =
        'insufficient budget on wallet 0xdeadbeefcafe remaining 812345 {"walletVkey":"secret"}';
      payX402Mock.mockResolvedValue(err({ kind: "ambiguous", message: leaky }));
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(app, validBody());

      expect(response.status).toBe(502);
      const body = (await response.json()) as { message: string; kind: string };
      expect(body.kind).toBe("x402_pay_outcome_unknown");
      expect(body.message).not.toContain("0xdeadbeefcafe");
      expect(body.message).not.toContain("812345");
      expect(body.message).not.toContain("walletVkey");
      // Still actionable: the coworker is told the one thing it can act on.
      expect(body.message).toContain("SAME idempotencyKey");
      // Operators lose nothing — the raw text is in the capture, as before.
      expect(captureMessageMock).toHaveBeenCalledWith(
        expect.stringContaining("sign outcome unknown"),
        expect.objectContaining({
          tags: { error_type: "task_x402_payment_ambiguous" },
          extra: expect.objectContaining({ reason: leaky }),
        }),
      );
    });
  });

  describe("signed authorization mismatch (defense-in-depth)", () => {
    async function expectHeldPending(response: Response) {
      expect(response.status).toBe(502);
      const body = (await response.json()) as {
        message: string;
        kind?: string;
      };
      expect(body.kind).toBe("x402_pay_outcome_unknown");
      // The node's version is never written and no header is returned.
      expect(outerPaymentUpdateManyMock).not.toHaveBeenCalled();
      expect(body.message).not.toContain(xPaymentHeader());
      // Held, not refunded: the doctrine only refunds a provable refusal.
      expect(tx.taskX402Payment.updateMany).not.toHaveBeenCalled();
      expect(tx.taskX402Payment.update).not.toHaveBeenCalled();
    }

    it("holds PENDING when the header signs a different `to` than the truthful summary claims", async () => {
      // THE attack the summary check cannot see. caip2Network/asset/amount/
      // payTo are the node's own scalars, siblings of the header in the same
      // JSON body: a compromised node reports the charged demand truthfully
      // while the header it hands back authorizes a transfer to someone else.
      // Every summary comparison passes; only the signed authorization
      // disagrees, and that is the thing that settles.
      payX402Mock.mockResolvedValue(
        ok(
          signedNodePayment({
            xPaymentHeader: xPaymentHeader({ to: OTHER_PAY_TO }),
          }),
        ),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      await expectHeldPending(await postPayment(app, validBody()));
      expect(captureMessageMock).toHaveBeenCalledWith(
        expect.stringContaining("did not match the charged demand"),
        expect.objectContaining({
          tags: { error_type: "task_x402_payment_signed_mismatch" },
        }),
      );
    });

    it("holds PENDING when the header signs a larger `value` than was charged", async () => {
      payX402Mock.mockResolvedValue(
        ok(
          signedNodePayment({
            xPaymentHeader: xPaymentHeader({ value: "999999999" }),
          }),
        ),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      await expectHeldPending(await postPayment(app, validBody()));
    });

    it("holds PENDING when the header signs a `from` other than the reported payer", async () => {
      // payerAddress is half of the nonce-replay unique. A node that reports
      // one payer while signing from another makes that key describe a wallet
      // that never signed.
      payX402Mock.mockResolvedValue(
        ok(
          signedNodePayment({
            xPaymentHeader: xPaymentHeader({
              from: "0x4444444444444444444444444444444444444444",
            }),
          }),
        ),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      await expectHeldPending(await postPayment(app, validBody()));
    });

    it("binds the signed payer to the managed wallet selected before charging", async () => {
      getX402ReadySourcesMock.mockResolvedValue([
        {
          caip2Network: BASE_SEPOLIA,
          asset: USDC_ADDRESS,
          evmWalletId: "wallet-1",
          evmWalletAddress: "0x4444444444444444444444444444444444444444",
          decimals: 6,
        },
      ]);
      const app = createApp(COWORKER_AGENT_CONTEXT);

      await expectHeldPending(await postPayment(app, validBody()));
      expect(captureMessageMock).toHaveBeenCalledWith(
        expect.stringContaining("did not match the charged demand"),
        expect.objectContaining({
          tags: { error_type: "task_x402_payment_signed_mismatch" },
        }),
      );
    });

    it.each([
      ["asset", { asset: EXPENSIVE_ASSET }],
      ["amount", { amount: "999999999" }],
      ["payTo", { payTo: OTHER_PAY_TO }],
    ])(
      "holds PENDING when the v2 accepted %s differs from the charged demand",
      async (_field, acceptedOverrides) => {
        payX402Mock.mockResolvedValue(
          ok(
            signedNodePayment({
              xPaymentHeader: xPaymentHeader({}, acceptedOverrides),
            }),
          ),
        );
        const app = createApp(COWORKER_AGENT_CONTEXT);

        await expectHeldPending(await postPayment(app, validBody()));
      },
    );

    it("holds PENDING when signed v2 domain terms differ from advertised terms", async () => {
      payX402Mock.mockResolvedValue(
        ok(
          signedNodePayment({
            xPaymentHeader: xPaymentHeader(
              {},
              {
                extra: { name: "Wrong Token", version: "2" },
              },
            ),
          }),
        ),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);
      const base = create402();
      const paymentRequired = {
        ...base,
        accepts: [
          {
            ...base.accepts[0],
            extra: { name: "USDC", version: "2" },
          },
        ],
      };

      await expectHeldPending(
        await postPayment(app, validBody({ paymentRequired })),
      );
    });

    it("rejects missing EIP-712 domain terms before charging", async () => {
      payX402Mock.mockResolvedValue(
        ok(
          signedNodePayment({
            xPaymentHeader: xPaymentHeader(
              {},
              {
                extra: { name: "Injected Token", version: "9" },
              },
            ),
          }),
        ),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);
      const base = create402();
      const [{ extra: _extra, ...withoutDomainTerms }] = base.accepts;
      const paymentRequired = {
        ...base,
        accepts: [withoutDomainTerms],
      };

      const response = await postPayment(app, validBody({ paymentRequired }));

      expect(response.status).toBe(422);
      expect(createTaskEventTransactionMock).not.toHaveBeenCalled();
      expect(tx.taskX402Payment.create).not.toHaveBeenCalled();
      expect(payX402Mock).not.toHaveBeenCalled();
      expect(outerPaymentUpdateManyMock).not.toHaveBeenCalled();
    });

    it("rejects a consistently signed but untrusted token domain before charging", async () => {
      // Even a cryptographically valid signature over attacker-selected
      // domain terms is not proof of a settleable USDC authorization. The
      // requirement must be rejected before debit, so this matching hostile
      // node response is never requested or accepted.
      payX402Mock.mockResolvedValue(
        ok(
          signedNodePayment({
            xPaymentHeader: xPaymentHeader(
              {},
              { extra: { name: "Counterfeit Coin", version: "9" } },
              { signature: WRONG_DOMAIN_SIGNATURE },
            ),
          }),
        ),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);
      const base = create402();
      const paymentRequired = {
        ...base,
        accepts: [
          {
            ...base.accepts[0],
            extra: { name: "Counterfeit Coin", version: "9" },
          },
        ],
      };

      const response = await postPayment(app, validBody({ paymentRequired }));

      expect(response.status).toBe(422);
      expect(createTaskEventTransactionMock).not.toHaveBeenCalled();
      expect(tx.taskX402Payment.create).not.toHaveBeenCalled();
      expect(payX402Mock).not.toHaveBeenCalled();
      expect(outerPaymentUpdateManyMock).not.toHaveBeenCalled();
    });

    it("holds PENDING when an omitted transfer method is signed as permit2", async () => {
      payX402Mock.mockResolvedValue(
        ok(
          signedNodePayment({
            xPaymentHeader: xPaymentHeader(
              {},
              {
                extra: {
                  name: "USDC",
                  version: "2",
                  assetTransferMethod: "permit2",
                },
              },
            ),
          }),
        ),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      await expectHeldPending(await postPayment(app, validBody()));
    });

    it("holds PENDING when signed maxTimeoutSeconds differs from the demand", async () => {
      payX402Mock.mockResolvedValue(
        ok(
          signedNodePayment({
            xPaymentHeader: xPaymentHeader({}, { maxTimeoutSeconds: 3600 }),
          }),
        ),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      await expectHeldPending(await postPayment(app, validBody()));
    });

    it("holds PENDING when validity outlives the echoed demand timeout", async () => {
      payX402Mock.mockResolvedValue(
        ok(
          signedNodePayment({
            xPaymentHeader: xPaymentHeader({
              validBefore: String(Math.floor(Date.now() / 1000) + 3600),
            }),
          }),
        ),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      await expectHeldPending(await postPayment(app, validBody()));
    });

    it.each([
      ["is not base64 JSON", "aGVhZGVy"],
      ["carries no authorization", Buffer.from("{}").toString("base64")],
    ])(
      "holds PENDING when the header %s, rather than storing it unverified",
      async (_label, header) => {
        // A header Soko cannot read is a header Soko cannot verify. Storing it
        // VERIFIED would hand the coworker a bearer instrument nobody checked;
        // the safe state is the PENDING hold, which is refund-safe and
        // replayable with the same key.
        payX402Mock.mockResolvedValue(
          ok(signedNodePayment({ xPaymentHeader: header })),
        );
        const app = createApp(COWORKER_AGENT_CONTEXT);

        const response = await postPayment(app, validBody());

        expect(response.status).toBe(502);
        const body = (await response.json()) as { kind?: string };
        expect(body.kind).toBe("x402_pay_outcome_unknown");
        expect(outerPaymentUpdateManyMock).not.toHaveBeenCalled();
        expect(tx.taskX402Payment.updateMany).not.toHaveBeenCalled();
        expect(captureMessageMock).toHaveBeenCalledWith(
          expect.stringContaining("could not be read"),
          expect.objectContaining({
            tags: { error_type: "task_x402_payment_header_unreadable" },
          }),
        );
      },
    );

    it("holds PENDING and answers 502 when the node signs a different payTo/amount than was charged", async () => {
      // Credits were charged for the verified demand, but a compromised or
      // clock-skewed node echoes a different payTo/amount. Storing that as
      // VERIFIED (or handing back its header) would re-target the payment away
      // from what the buyer paid for — so it must be treated as ambiguous.
      payX402Mock.mockResolvedValue(
        ok(signedNodePayment({ payTo: OTHER_PAY_TO, amount: "999999999" })),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(app, validBody());

      await expectHeldPending(response);
      // Paged as a node-integrity signal for ops.
      expect(captureMessageMock).toHaveBeenCalledWith(
        expect.stringContaining("did not match the charged demand"),
        expect.objectContaining({
          tags: { error_type: "task_x402_payment_signed_mismatch" },
        }),
      );
    });
  });

  describe("unsettleable signed header", () => {
    async function expectHeldPendingUnsettleable(response: Response) {
      expect(response.status).toBe(502);
      const body = (await response.json()) as { kind?: string };
      expect(body.kind).toBe("x402_pay_outcome_unknown");
      // NOT stored VERIFIED: that status is terminal for the refund path
      // (refundRefusedTaskX402Payment refuses a verified row outright), so
      // writing it would park the charge behind an operator ticket.
      expect(outerPaymentUpdateManyMock).not.toHaveBeenCalled();
      // And NEVER refunded: the node DID sign. A header may exist, so the
      // doctrine holds PENDING and lets the same-key replay re-run the sign.
      expect(tx.taskX402Payment.updateMany).not.toHaveBeenCalled();
      expect(tx.taskX402Payment.update).not.toHaveBeenCalled();
    }

    it("holds PENDING when the header carries no signature at all", async () => {
      payX402Mock.mockResolvedValue(
        ok(
          signedNodePayment({
            xPaymentHeader: xPaymentHeader({}, {}, { signature: undefined }),
          }),
        ),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      await expectHeldPendingUnsettleable(await postPayment(app, validBody()));
      expect(captureMessageMock).toHaveBeenCalledWith(
        expect.stringContaining("could not be read"),
        expect.objectContaining({
          tags: { error_type: "task_x402_payment_header_unreadable" },
        }),
      );
    });

    it("holds PENDING when a well-shaped EIP-712 signature is not from the managed wallet", async () => {
      payX402Mock.mockResolvedValue(
        ok(
          signedNodePayment({
            xPaymentHeader: xPaymentHeader(
              {},
              {},
              { signature: `0x${"ab".repeat(65)}` },
            ),
          }),
        ),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      await expectHeldPendingUnsettleable(await postPayment(app, validBody()));
      expect(captureMessageMock).toHaveBeenCalledWith(
        expect.stringContaining("failed EIP-712 verification"),
        expect.objectContaining({
          tags: { error_type: "task_x402_payment_signature_invalid" },
        }),
      );
    });

    it("holds PENDING when a matching transfer was signed under the wrong token domain", async () => {
      // Header envelope still repeats trusted USDC terms. Only cryptographic
      // recovery against Soko's trusted domain detects that node actually
      // signed identical transfer fields under attacker-selected metadata.
      payX402Mock.mockResolvedValue(
        ok(
          signedNodePayment({
            xPaymentHeader: xPaymentHeader(
              {},
              {},
              { signature: WRONG_DOMAIN_SIGNATURE },
            ),
          }),
        ),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      await expectHeldPendingUnsettleable(await postPayment(app, validBody()));
      expect(captureMessageMock).toHaveBeenCalledWith(
        expect.stringContaining("failed EIP-712 verification"),
        expect.objectContaining({
          tags: { error_type: "task_x402_payment_signature_invalid" },
        }),
      );
    });

    it("holds PENDING when the authorization has already expired", async () => {
      // The window closed before the coworker ever saw the header, so it can
      // never settle — but the transfer it describes matches the charge
      // perfectly, so every who/how-much assertion passed and the charge
      // landed on a VERIFIED row the refund path refuses to touch.
      payX402Mock.mockResolvedValue(
        ok(
          signedNodePayment({
            xPaymentHeader: xPaymentHeader({
              validBefore: String(Math.floor(Date.now() / 1000) - 60),
            }),
          }),
        ),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      await expectHeldPendingUnsettleable(await postPayment(app, validBody()));
    });

    it("holds PENDING when too little authorization lifetime remains", async () => {
      payX402Mock.mockResolvedValue(
        ok(
          signedNodePayment({
            xPaymentHeader: xPaymentHeader({
              validBefore: String(Math.floor(Date.now() / 1000) + 5),
            }),
          }),
        ),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      await expectHeldPendingUnsettleable(await postPayment(app, validBody()));
      expect(captureMessageMock).toHaveBeenCalledWith(
        expect.stringContaining("cannot settle the charge"),
        expect.objectContaining({
          extra: expect.objectContaining({
            reason: "insufficient_remaining_lifetime",
          }),
        }),
      );
    });

    it("holds PENDING when a future-start authorization has only one usable second", async () => {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const validAfter = nowSeconds + 59;
      const validBefore = nowSeconds + 60;
      const signature = await signAuthorization(
        PAYLOAD_NONCE,
        validBefore,
        validAfter,
      );
      payX402Mock.mockResolvedValue(
        ok(
          signedNodePayment({
            xPaymentHeader: xPaymentHeader(
              {
                validAfter: String(validAfter),
                validBefore: String(validBefore),
              },
              {},
              { signature },
            ),
          }),
        ),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      await expectHeldPendingUnsettleable(await postPayment(app, validBody()));
      expect(captureMessageMock).toHaveBeenCalledWith(
        expect.stringContaining("cannot settle the charge"),
        expect.objectContaining({
          extra: expect.objectContaining({
            reason: "insufficient_remaining_lifetime",
          }),
        }),
      );
    });

    it("holds PENDING when the authorization expires absurdly far in the future", async () => {
      // The other end of the window, and the one with no fence at all: the
      // expiry check rejected only `validBefore <= now`, so a year-5138
      // expiry described the charged transfer perfectly and was written
      // VERIFIED — storing a bearer credential that authorizes Soko's managed
      // wallet essentially forever. Both purge arms then miss it: it is not
      // `lte: now`, and its `validBefore` is not null.
      //
      // No honest node can produce one — the forwarded 402's
      // `maxTimeoutSeconds` is capped at X402_MAX_TIMEOUT_SECONDS and the node
      // signs `validBefore = signTime + maxTimeoutSeconds` — but nothing
      // checked, and the column is written verbatim from the header.
      for (const validBefore of ["99999999999", "253402300799"]) {
        payX402Mock.mockResolvedValue(
          ok(
            signedNodePayment({
              xPaymentHeader: xPaymentHeader({ validBefore }),
            }),
          ),
        );
        const app = createApp(COWORKER_AGENT_CONTEXT);

        await expectHeldPendingUnsettleable(
          await postPayment(app, validBody()),
        );
      }
    });

    it("accepts the longest authorization an honest node can mint", async () => {
      // The fence above must not close on the legitimate maximum. A 402 may
      // ask for X402_MAX_TIMEOUT_SECONDS and the node signs exactly
      // `signTime + maxTimeoutSeconds`, so the cap itself has to pass — the
      // only headroom the fence adds beyond it is clock skew.
      payX402Mock.mockResolvedValue(
        ok(
          signedNodePayment({
            xPaymentHeader: xPaymentHeader(
              {
                validBefore: String(MAX_VALID_BEFORE_SECONDS),
              },
              {
                maxTimeoutSeconds: X402_MAX_TIMEOUT_SECONDS,
              },
              { signature: MAX_TIMEOUT_SIGNATURE },
            ),
          }),
        ),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const maxTimeoutDemand = create402({
        accepts: [
          {
            ...create402().accepts[0],
            maxTimeoutSeconds: X402_MAX_TIMEOUT_SECONDS,
          },
        ],
      });
      const response = await postPayment(
        app,
        validBody({ paymentRequired: maxTimeoutDemand }),
      );

      expect(response.status).toBe(200);
    });

    it("holds PENDING when the authorization is not valid yet", async () => {
      // validAfter in the year 5138: the mirror of an expired header, and the
      // same outcome for the buyer.
      payX402Mock.mockResolvedValue(
        ok(
          signedNodePayment({
            xPaymentHeader: xPaymentHeader({ validAfter: "99999999999" }),
          }),
        ),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      await expectHeldPendingUnsettleable(await postPayment(app, validBody()));
    });

    it("holds PENDING when the envelope names a different chain than was charged", async () => {
      // The summary scalars say Base Sepolia and the authorization pays the
      // right address the right amount — but the signature is bound to Base
      // MAINNET, where the charge was never priced and the payee may not even
      // be the same party. The EIP-712 domain that truly binds the chain is
      // not in the header, so this envelope field is the only cross-check
      // there is.
      payX402Mock.mockResolvedValue(
        ok(
          signedNodePayment({
            xPaymentHeader: xPaymentHeader({}, { network: BASE_MAINNET }),
          }),
        ),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      await expectHeldPendingUnsettleable(await postPayment(app, validBody()));
      expect(captureMessageMock).toHaveBeenCalledWith(
        expect.stringContaining("cannot settle the charge"),
        expect.objectContaining({
          tags: { error_type: "task_x402_payment_unsettleable_header" },
        }),
      );
    });

    it("holds PENDING when the envelope's scheme is only a drifted spelling of a supported one", async () => {
      // A facilitator reads `scheme` verbatim, so "Exact" is not the "exact"
      // scheme — it is an unsettleable header. The parse used to fold the
      // field with `.trim().toLowerCase()`, which meant the supported-scheme
      // fence passed on a string nothing downstream ever sees, and the charge
      // landed on a VERIFIED row behind an instrument that settles nowhere.
      for (const scheme of ["Exact", "  exact  "]) {
        payX402Mock.mockResolvedValue(
          ok(
            signedNodePayment({
              xPaymentHeader: xPaymentHeader({}, { scheme }),
            }),
          ),
        );
        const app = createApp(COWORKER_AGENT_CONTEXT);

        await expectHeldPendingUnsettleable(
          await postPayment(app, validBody()),
        );
      }
    });

    it("holds PENDING when the envelope declares an unsupported scheme", async () => {
      // `upto` is a real x402 scheme with different settlement semantics, not
      // a hypothetical. The 402 side already refuses it pre-charge
      // (X402_SUPPORTED_SCHEMES); the signed side did not check at all.
      payX402Mock.mockResolvedValue(
        ok(
          signedNodePayment({
            xPaymentHeader: xPaymentHeader({}, { scheme: "upto" }),
          }),
        ),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      await expectHeldPendingUnsettleable(await postPayment(app, validBody()));
    });

    it("accepts the v1 spelling of the charged chain rather than holding a good payment", async () => {
      // The fence must compare CHAINS, not spellings: `base-sepolia` IS
      // eip155:84532. Holding this would be the fence causing the very harm it
      // exists to prevent — a stuck charge behind a perfectly good header.
      payX402Mock.mockResolvedValue(
        ok(
          signedNodePayment({
            xPaymentHeader: xPaymentHeader({}, { network: "base-sepolia" }),
          }),
        ),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(app, validBody());

      expect(response.status).toBe(200);
      expect(outerPaymentUpdateManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "VERIFIED" }),
        }),
      );
    });

    it("holds PENDING when signed validity timestamps are unreadable", async () => {
      payX402Mock.mockResolvedValue(
        ok(
          signedNodePayment({
            xPaymentHeader: xPaymentHeader({
              validBefore: "not-a-number",
              validAfter: "not-a-number",
            }),
          }),
        ),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(app, validBody());

      expect(response.status).toBe(502);
      const body = (await response.json()) as { kind?: string };
      expect(body.kind).toBe("x402_pay_outcome_unknown");
      expect(outerPaymentUpdateManyMock).not.toHaveBeenCalled();
    });
  });

  describe("finalize could not claim the PENDING record", () => {
    it("holds PENDING and gives same-key guidance when VERIFIED persistence fails", async () => {
      const persistenceError = Object.assign(new Error("unique violation"), {
        code: "P2002",
      });
      outerPaymentUpdateManyMock.mockRejectedValue(persistenceError);
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(app, validBody());

      expect(response.status).toBe(502);
      const body = (await response.json()) as {
        kind?: string;
        message?: string;
      };
      expect(body.kind).toBe("x402_pay_outcome_unknown");
      expect(body.message).toContain("SAME idempotencyKey");
      expect(captureExceptionMock).toHaveBeenCalledWith(
        persistenceError,
        expect.objectContaining({
          tags: {
            error_type: "task_x402_payment_finalize_persistence_failed",
          },
        }),
      );
      expect(outerPaymentFindUniqueMock).not.toHaveBeenCalled();
    });

    it("pages when a second sign lands on an already-VERIFIED row, and still returns the stored result", async () => {
      // The other half of the sign-lease backstop. Its FAILED/REFUNDED sibling
      // pages loudly; this branch returned the stored header silently, even
      // though reaching it with a DIFFERENT attemptId means two node signs
      // happened and a live EIP-3009 authorization is being discarded — the
      // exact event the lease exists to prevent. Money-safe (only one header is
      // ever delivered per record), so the answer stays 200; what was missing
      // is the signal. The header itself is never logged.
      outerPaymentUpdateManyMock.mockResolvedValue({ count: 0 });
      outerPaymentFindUniqueMock.mockResolvedValue(
        createPaymentRecord({
          status: "VERIFIED",
          attemptId: "attempt_from_the_other_request",
          xPaymentHeader: xPaymentHeader(),
        }),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(app, validBody());

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        data: { attemptId: string; paymentHeader: { value: string } };
      };
      // The stored result wins — one header per record, always the first one.
      expect(body.data.attemptId).toBe("attempt_from_the_other_request");
      expect(body.data.paymentHeader.value).toBe(xPaymentHeader());
      expect(captureMessageMock).toHaveBeenCalledWith(
        expect.stringContaining("signed twice"),
        expect.objectContaining({
          tags: { error_type: "task_x402_payment_signed_after_verify" },
        }),
      );
      // Never the bearer instrument, in either direction.
      const [, context] = captureMessageMock.mock.calls.find(
        ([, options]) =>
          (options as { tags?: { error_type?: string } })?.tags?.error_type ===
          "task_x402_payment_signed_after_verify",
      ) as [string, { extra: Record<string, unknown> }];
      expect(JSON.stringify(context.extra)).not.toContain("c3RvcmVk");
      expect(JSON.stringify(context.extra)).not.toContain(xPaymentHeader());
    });

    it("stays quiet when the same attempt re-finalizes an already-VERIFIED row", async () => {
      // Same attemptId is not a double sign — it is one node result whose
      // VERIFIED write was already applied (a concurrent replay of the same
      // request, or a retried write). Paging on it would train ops to ignore
      // the alert that matters.
      outerPaymentUpdateManyMock.mockResolvedValue({ count: 0 });
      outerPaymentFindUniqueMock.mockResolvedValue(
        createPaymentRecord({
          status: "VERIFIED",
          attemptId: "attempt_1",
          xPaymentHeader: xPaymentHeader(),
        }),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(app, validBody());

      expect(response.status).toBe(200);
      expect(captureMessageMock).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          tags: { error_type: "task_x402_payment_signed_after_verify" },
        }),
      );
    });

    it("pages and answers 409 when the row was already refunded out from under a real signature", async () => {
      // The residual of the concurrent-sign window: the node really did sign,
      // but the record is FAILED because another request already refunded it.
      // A bare 500 here would hide the worst state this flow can reach — a
      // live authorization Soko signed and threw away — so it is paged
      // explicitly, and the caller is told the truthful, actionable thing:
      // the key is consumed and its charge is back.
      outerPaymentUpdateManyMock.mockResolvedValue({ count: 0 });
      outerPaymentFindUniqueMock.mockResolvedValue(
        createPaymentRecord({
          status: "FAILED",
          failureReason: "node_refused_operational",
        }),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(app, validBody());

      expect(response.status).toBe(409);
      const body = (await response.json()) as { kind?: string };
      expect(body.kind).toBe("x402_payment_key_consumed");
      expect(captureMessageMock).toHaveBeenCalledWith(
        expect.stringContaining("signed after its record was closed"),
        expect.objectContaining({
          tags: { error_type: "task_x402_payment_signed_after_close" },
        }),
      );
    });

    it("pages and answers 500 when the record has vanished", async () => {
      outerPaymentUpdateManyMock.mockResolvedValue({ count: 0 });
      outerPaymentFindUniqueMock.mockResolvedValue(null);
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(app, validBody());

      expect(response.status).toBe(500);
      expect(captureMessageMock).toHaveBeenCalledWith(
        expect.stringContaining("could not be finalized"),
        expect.objectContaining({
          tags: { error_type: "task_x402_payment_finalize_failed" },
        }),
      );
    });
  });

  describe("out of credits", () => {
    beforeEach(() => {
      createTaskEventTransactionMock.mockRejectedValue(
        unprocessableEntity("Insufficient balance", {
          kind: CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE,
        }),
      );
    });

    it("pauses a running task to OUT_OF_CREDITS and answers 422 with the kind", async () => {
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(app, validBody());

      expect(response.status).toBe(422);
      const body = (await response.json()) as {
        kind: string;
        attemptedCredits: number;
      };
      expect(body.kind).toBe(CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE);
      expect(body.attemptedCredits).toBe(0.5);

      // The pause event and the guarded status flip committed; no payment
      // record, no sign.
      // The pause event carries the ATTEMPTED cents, mirroring the
      // task-events route: the charge failed, but the timeline must still
      // show what the coworker tried to spend, not just that the task
      // paused. (transactionId stays absent — nothing was debited.)
      expect(tx.taskEvent.create).toHaveBeenCalledWith({
        data: {
          taskId: TASK_ID,
          status: TaskStatus.OUT_OF_CREDITS,
          coworkerId: COWORKER_ID,
          cents: CENTS_FOR_DEMAND,
        },
      });
      expect(tx.task.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: TASK_ID, status: TaskStatus.RUNNING },
        }),
      );
      expect(tx.taskX402Payment.create).not.toHaveBeenCalled();
      expect(payX402Mock).not.toHaveBeenCalled();

      // The pause notifies the owner through the shared notification path.
      await Promise.all(waitUntilCapturedPromises);
      expect(createNotificationMock).toHaveBeenCalledWith(
        expect.objectContaining({
          messageKey: "Notifications.Task.outOfCredits",
          userId: USER_ID,
        }),
      );
      expect(publishTaskEventDataMock).toHaveBeenCalled();
    });

    it("keeps a terminal task's status and answers a plain 422", async () => {
      requireTaskCollaborationMock.mockResolvedValue(
        createTask({ status: TaskStatus.COMPLETED }),
      );
      const app = createApp(COWORKER_AGENT_CONTEXT);

      const response = await postPayment(app, validBody());

      expect(response.status).toBe(422);
      expect(tx.taskEvent.create).not.toHaveBeenCalled();
      expect(tx.task.updateMany).not.toHaveBeenCalled();
      expect(payX402Mock).not.toHaveBeenCalled();
    });
  });
});
