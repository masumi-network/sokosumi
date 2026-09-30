import {
  type CoworkerMpsSellerBinding,
  Prisma,
  type TaskMpsPaymentQuote,
  TaskStatus,
} from "@sokosumi/database";
import { err, ok } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { conflict } from "@/helpers/error";
import type { UserAuthenticationContext } from "@/middleware/auth";
import {
  approveTaskMpsPaymentQuote,
  createTaskMpsPaymentQuote,
  getTaskMpsPaymentQuote,
  revokeTaskMpsPaymentQuote,
} from "./task-mps-payment-quote.service";

const mocks = vi.hoisted(() => ({
  owner: vi.fn(),
  verify: vi.fn(),
  createQuote: vi.fn(),
  recover: vi.fn(),
  costs: vi.fn(),
  binding: { findFirst: vi.fn() },
  quote: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    coworkerMpsSellerBinding: mocks.binding,
    taskMpsPaymentQuote: mocks.quote,
  },
}));
vi.mock("@/lib/db/transaction", () => ({
  serializableTransaction: async (callback: (tx: object) => unknown) =>
    callback({
      coworkerMpsSellerBinding: mocks.binding,
      taskMpsPaymentQuote: mocks.quote,
    }),
}));
vi.mock("@/helpers/mps-payment-access", () => ({
  requireTaskPaymentOwner: mocks.owner,
}));
vi.mock("@/helpers/agent", () => ({ getCreditCostsOrThrow: mocks.costs }));
vi.mock("@/config/env", () => ({ getEnv: () => ({ NETWORK: "Preprod" }) }));
vi.mock("@/lib/auth", () => ({ auth: {} }));
vi.mock("./mps-seller.service", () => ({
  sellerCipher: () => ({ decrypt: () => "fixture-key" }),
  sellerCredentialContext: () => ({}),
  sellerClient: () => ({
    verifySeller: mocks.verify,
    createQuote: mocks.createQuote,
    recoverQuote: mocks.recover,
  }),
}));

const auth: UserAuthenticationContext = {
  actor: "user",
  userId: "owner",
  organizationId: "current-workspace-org",
  role: "user",
};
const now = new Date("2026-09-30T12:00:00Z");
const task = {
  id: "task",
  ownerId: "owner",
  organizationId: "billing-org",
  assigneeId: "coworker",
  name: "Task name",
  description: "Task input",
  status: TaskStatus.READY,
  archivedAt: null,
};
const binding: CoworkerMpsSellerBinding & { coworker: { vendorId: string } } = {
  id: "binding",
  createdAt: now,
  coworkerId: "coworker",
  vendorId: "vendor",
  network: "Preprod",
  apiUrl: "https://seller.example",
  agentIdentifier: "ab".repeat(32),
  walletId: "wallet",
  paymentSourceId: "source",
  apiKeyId: "key-id",
  sellerVkey: "cd".repeat(28),
  walletAddress: "wallet-address",
  sellerReturnAddress: null,
  policyId: "ab".repeat(28),
  paymentSourceType: "Web3CardanoV1",
  smartContractAddress: "contract-address",
  supportedPaymentSourceIndex: null,
  encryptedApiKey: "encrypted-only",
  verifiedAt: now,
  createdByUserId: "developer",
  revokedAt: null,
  coworker: { vendorId: "vendor" },
};
const input = {
  idempotencyKey: "request-1",
  payByTime: "2026-09-30T13:00:00Z",
  submitResultTime: "2026-09-30T14:00:00Z",
  unlockTime: "2026-09-30T15:00:00Z",
  externalDisputeUnlockTime: "2026-09-30T16:00:00Z",
};
let stored: TaskMpsPaymentQuote | null;
function requireStored() {
  if (!stored) throw new Error("Missing quote fixture");
  return stored;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  vi.clearAllMocks();
  stored = null;
  mocks.owner.mockResolvedValue({ ...task });
  mocks.binding.findFirst.mockResolvedValue({ ...binding });
  mocks.verify.mockResolvedValue(
    ok({
      ...binding,
      collectionAddress: null,
      amounts: [{ unit: "", amount: "100" }],
      supportedPaymentSourceIndex: undefined,
    }),
  );
  mocks.costs.mockResolvedValue([
    { unit: "lovelace", centsPerUnit: 10_000_000_000n },
  ]);
  mocks.quote.findUnique.mockImplementation(async () => stored);
  mocks.quote.findFirst.mockImplementation(async () => stored);
  mocks.quote.create.mockImplementation(
    async ({ data }: { data: Partial<TaskMpsPaymentQuote> }) => {
      stored = {
        id: "quote",
        createdAt: now,
        updatedAt: now,
        taskId: "task",
        sellerBindingId: "binding",
        coworkerId: "coworker",
        billingOwnerId: "owner",
        billingOrganizationId: "billing-org",
        network: "Preprod",
        idempotencyKey: "request-1",
        inputHash: "00".repeat(32),
        identifierFromPurchaser: "00".repeat(10),
        requestPayload: {},
        quotedTerms: null,
        blockchainIdentifierHash: null,
        termsHash: null,
        quotedCents: null,
        maxCents: null,
        expiresAt: new Date(now.getTime() + 900_000),
        quotedAt: null,
        approvedByUserId: null,
        approvedAt: null,
        revokedAt: null,
        consumedAt: null,
        claimId: null,
        ...data,
      };
      return { ...stored };
    },
  );
  mocks.quote.update.mockImplementation(
    async ({ data }: { data: Partial<TaskMpsPaymentQuote> }) => {
      stored = { ...requireStored(), ...data };
      return { ...stored };
    },
  );
  mocks.createQuote.mockImplementation(async (request) => {
    expect(stored).not.toBeNull();
    return ok({
      paymentId: "payment",
      blockchainIdentifier: "blockchain-identifier",
      agentIdentifier: binding.agentIdentifier,
      sellerVkey: binding.sellerVkey,
      inputHash: request.inputHash,
      identifierFromPurchaser: request.identifierFromPurchaser,
      Amounts: request.amounts,
      payByTime: request.payByTime,
      submitResultTime: request.submitResultTime,
      unlockTime: request.unlockTime,
      externalDisputeUnlockTime: request.externalDisputeUnlockTime,
      paymentSourceType: binding.paymentSourceType,
      smartContractAddress: binding.smartContractAddress,
      sellerReturnAddress: null,
    });
  });
  mocks.recover.mockResolvedValue(
    err({ kind: "not_found", message: "Not found" }),
  );
});
afterEach(() => vi.useRealTimers());

async function quote() {
  return createTaskMpsPaymentQuote(auth, "task", input);
}
async function approve(maxCredits = 100) {
  return approveTaskMpsPaymentQuote(auth, "task", requireStored().id, {
    termsHash: requireStored().termsHash!,
    maxCredits,
  });
}

describe("Task MPS quote creation", () => {
  it("persists intent before the only seller POST and never funds it", async () => {
    const result = await quote();
    expect(result).toMatchObject({
      state: "quoted",
      quotedCredits: 100,
      maxCredits: null,
      paymentsEnabled: false,
      billingOrganizationId: "billing-org",
    });
    expect(requireStored().requestPayload).toMatchObject({
      payByTime: String(Date.parse(input.payByTime)),
    });
    expect(requireStored().claimId).toBeNull();
    expect(requireStored().consumedAt).toBeNull();
    expect(JSON.stringify(result)).not.toContain("fixture-key");
    expect(mocks.createQuote).toHaveBeenCalledTimes(1);
    expect(mocks.quote.create.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createQuote.mock.invocationCallOrder[0],
    );
  });
  it("returns the same quoted request without another remote call", async () => {
    const first = await quote();
    expect(await quote()).toEqual(first);
    expect(mocks.createQuote).toHaveBeenCalledTimes(1);
    expect(mocks.verify).toHaveBeenCalledTimes(1);
  });
  it("never retries a POST after an ambiguous outcome", async () => {
    mocks.createQuote.mockResolvedValue(
      err({ kind: "ambiguous", message: "Unknown outcome" }),
    );
    expect((await quote()).state).toBe("unresolved");
    expect((await quote()).state).toBe("unresolved");
    expect(mocks.createQuote).toHaveBeenCalledTimes(1);
    expect(mocks.recover).toHaveBeenCalledTimes(1);
  });
  it("recovers the existing intent through a read", async () => {
    const original = mocks.createQuote.getMockImplementation()!;
    mocks.createQuote.mockResolvedValue(
      err({ kind: "ambiguous", message: "Unknown outcome" }),
    );
    await quote();
    mocks.recover.mockImplementation(original);
    expect((await quote()).state).toBe("quoted");
    expect(mocks.createQuote).toHaveBeenCalledTimes(1);
  });
  it("rejects idempotency key reuse with different deadlines", async () => {
    await quote();
    await expect(
      createTaskMpsPaymentQuote(auth, "task", {
        ...input,
        payByTime: "2026-09-30T13:01:00Z",
      }),
    ).rejects.toThrow("different deadlines");
    expect(mocks.createQuote).toHaveBeenCalledTimes(1);
  });
  it("rejects concurrent idempotency key reuse with different deadlines", async () => {
    await quote();
    mocks.quote.findUnique.mockResolvedValueOnce(null);
    await expect(
      createTaskMpsPaymentQuote(auth, "task", {
        ...input,
        payByTime: "2026-09-30T13:01:00Z",
      }),
    ).rejects.toThrow("different deadlines");
    expect(mocks.createQuote).toHaveBeenCalledTimes(1);
  });
  it.each([
    {
      payByTime: "2026-09-30T12:01:00Z",
      submitResultTime: "2026-09-30T12:14:00Z",
    },
    { payByTime: "2026-09-30T13:56:00Z" },
    { unlockTime: "2026-09-30T14:14:00Z" },
    { externalDisputeUnlockTime: "2026-09-30T15:14:00Z" },
  ])(
    "rejects MPS deadline minimum violations before storing an intent: %j",
    async (change) => {
      await expect(
        createTaskMpsPaymentQuote(auth, "task", { ...input, ...change }),
      ).rejects.toThrow("deadlines");
      expect(mocks.verify).not.toHaveBeenCalled();
      expect(mocks.quote.create).not.toHaveBeenCalled();
    },
  );
  it("reports a known seller rejection without another POST", async () => {
    mocks.createQuote.mockResolvedValue(
      err({ kind: "rejected", message: "Rejected" }),
    );
    await expect(quote()).rejects.toMatchObject({ status: 422 });
    expect(requireStored().quotedAt).toBeNull();
    expect((await quote()).state).toBe("unresolved");
    expect(mocks.createQuote).toHaveBeenCalledTimes(1);
    expect(mocks.recover).toHaveBeenCalledTimes(1);
  });
  it.each([
    "payByTime",
    "submitResultTime",
    "unlockTime",
    "externalDisputeUnlockTime",
  ] as const)(
    "rejects invalid order for %s before seller access",
    async (key) => {
      await expect(
        createTaskMpsPaymentQuote(auth, "task", {
          ...input,
          [key]: "2026-09-30T11:00:00Z",
        }),
      ).rejects.toThrow("deadlines");
      expect(mocks.verify).not.toHaveBeenCalled();
      expect(mocks.quote.create).not.toHaveBeenCalled();
    },
  );
  it("rejects missing seller setup", async () => {
    mocks.binding.findFirst.mockResolvedValue(null);
    await expect(quote()).rejects.toThrow("no active MPS seller");
    expect(mocks.createQuote).not.toHaveBeenCalled();
  });
  it("rejects changed seller key identity before storing an intent", async () => {
    const verified = (await mocks.verify()).value;
    mocks.verify.mockResolvedValue(
      ok({ ...verified, apiKeyId: "replacement-key" }),
    );
    await expect(quote()).rejects.toThrow("reconnect");
    expect(mocks.quote.create).not.toHaveBeenCalled();
  });
  it("rejects V2 quotes without an authoritative source index", async () => {
    mocks.binding.findFirst.mockResolvedValue({
      ...binding,
      paymentSourceType: "Web3CardanoV2",
    });
    const verified = (await mocks.verify()).value;
    mocks.verify.mockResolvedValue(
      ok({ ...verified, paymentSourceType: "Web3CardanoV2" }),
    );
    await expect(quote()).rejects.toThrow("index");
    expect(mocks.createQuote).not.toHaveBeenCalled();
  });
  it("rechecks owner access after the remote read", async () => {
    mocks.owner
      .mockResolvedValueOnce(task)
      .mockRejectedValue(conflict("Access changed"));
    await expect(quote()).rejects.toThrow("Access changed");
    expect(mocks.quote.create).not.toHaveBeenCalled();
  });
  it("keeps unresolved intent when saving quote terms fails", async () => {
    mocks.quote.update.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(quote()).rejects.toThrow("database unavailable");
    expect(requireStored().quotedAt).toBeNull();
    await quote();
    expect(mocks.createQuote).toHaveBeenCalledTimes(1);
  });
});

describe("Task MPS quote approval", () => {
  it("records owner consent and the ceiling without a debit or claim", async () => {
    await quote();
    expect(await approve()).toMatchObject({
      state: "approved",
      maxCredits: 100,
      paymentsEnabled: false,
    });
    expect(requireStored()).toMatchObject({
      approvedByUserId: "owner",
      claimId: null,
      consumedAt: null,
    });
    expect(mocks.createQuote).toHaveBeenCalledTimes(1);
  });
  it("makes repeat approval idempotent", async () => {
    await quote();
    const first = await approve();
    expect(await approve()).toEqual(first);
  });
  it("rejects changed terms hash", async () => {
    await quote();
    await expect(
      approveTaskMpsPaymentQuote(auth, "task", requireStored().id, {
        termsHash: "00".repeat(32),
        maxCredits: 100,
      }),
    ).rejects.toThrow("Review");
    expect(requireStored().approvedAt).toBeNull();
  });
  it("rejects mutated stored terms even with the old hash", async () => {
    await quote();
    requireStored().quotedTerms = {
      ...(requireStored().quotedTerms as Prisma.JsonObject),
      sellerVkey: "ef".repeat(28),
    };
    await expect(approve()).rejects.toThrow("Stored quote terms");
  });
  it("rejects a ceiling below the current conversion", async () => {
    await quote();
    await expect(approve(99)).rejects.toThrow("ceiling");
    expect(requireStored().approvedAt).toBeNull();
  });
  it("recalculates credits inside approval", async () => {
    await quote();
    mocks.costs.mockResolvedValue([
      { unit: "lovelace", centsPerUnit: 20_000_000_000n },
    ]);
    await expect(approve(100)).rejects.toThrow("ceiling");
  });
  it("rejects changing an approved ceiling", async () => {
    await quote();
    await approve();
    await expect(approve(101)).rejects.toThrow("cannot be changed");
  });
  it.each([
    { ownerId: "another-owner" },
    { organizationId: "another-org" },
    { organizationId: null },
    { assigneeId: "another-coworker" },
  ])("rejects changed billing identity or assignee: %j", async (change) => {
    await quote();
    mocks.owner.mockResolvedValue({ ...task, ...change });
    await expect(approve()).rejects.toThrow("billing identity");
  });
  it("uses original billing identity after a Workspace move", async () => {
    await quote();
    expect((await approve()).billingOrganizationId).toBe("billing-org");
  });
  it("rejects changed Task input", async () => {
    await quote();
    mocks.owner.mockResolvedValue({ ...task, description: "changed input" });
    await expect(approve()).rejects.toThrow("input or status changed");
  });
  it.each([TaskStatus.COMPLETED, TaskStatus.CANCELED])(
    "rejects terminal Task status %s",
    async (status) => {
      await quote();
      mocks.owner.mockResolvedValue({ ...task, status });
      await expect(approve()).rejects.toThrow("status changed");
    },
  );
  it("rejects expired quotes", async () => {
    await quote();
    vi.setSystemTime(now.getTime() + 901_000);
    await expect(approve()).rejects.toThrow("expired");
  });
  it("rejects revoked seller bindings", async () => {
    await quote();
    mocks.binding.findFirst.mockResolvedValue(null);
    await expect(approve()).rejects.toThrow("Seller configuration changed");
  });
  it("revokes approval and prevents later approval", async () => {
    await quote();
    await approve();
    expect(
      (await revokeTaskMpsPaymentQuote(auth, "task", requireStored().id)).state,
    ).toBe("revoked");
    await expect(approve()).rejects.toThrow("revoked");
  });
  it("rejects revoking a consumed quote even if its claim was deleted", async () => {
    await quote();
    requireStored().consumedAt = now;
    requireStored().claimId = null;
    await expect(
      revokeTaskMpsPaymentQuote(auth, "task", requireStored().id),
    ).rejects.toThrow("consumed");
  });
  it("does not expose the request metadata or credential in GET", async () => {
    await quote();
    const dto = await getTaskMpsPaymentQuote(auth, "task", requireStored().id);
    expect(dto).not.toHaveProperty("requestPayload");
    expect(dto).not.toHaveProperty("encryptedApiKey");
  });
});
