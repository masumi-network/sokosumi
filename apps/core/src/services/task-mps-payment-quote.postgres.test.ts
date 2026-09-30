/**
 * Use a disposable loopback PostgreSQL database named mps_baseline.
 * Apply all migrations, then select this file with RUN_DATABASE_INTEGRATION_TESTS=true.
 * MPS calls are mocked; storage, ownership, transactions, and constraints are real.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { TaskStatus } from "@sokosumi/database";
import { err, ok } from "neverthrow";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import prisma from "@/lib/db/prisma";
import type { UserAuthenticationContext } from "@/middleware/auth";
import {
  approveTaskMpsPaymentQuote,
  createTaskMpsPaymentQuote,
} from "./task-mps-payment-quote.service";

const mps = vi.hoisted(() => ({
  verifySeller: vi.fn(),
  createQuote: vi.fn(),
  recoverQuote: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: {} }));
vi.mock("@vercel/functions", () => ({
  attachDatabasePool: vi.fn(),
  waitUntil: vi.fn(),
}));
vi.mock("./mps-seller.service", () => ({
  sellerCipher: () => ({ decrypt: () => "fixture-key" }),
  sellerCredentialContext: () => ({}),
  sellerClient: () => mps,
}));

const userId = randomUUID(),
  vendorId = randomUUID(),
  coworkerId = randomUUID(),
  workspaceId = randomUUID(),
  bindingId = randomUUID();
const unit = randomBytes(28).toString("hex") + "01";
const auth: UserAuthenticationContext = {
  actor: "user",
  userId,
  organizationId: null,
  role: "user",
};
const taskIds: string[] = [];
let initialTransactions: number, initialClaims: number;
let fixturesStarted = false;
const binding = {
  id: bindingId,
  coworkerId,
  vendorId,
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
  encryptedApiKey: "encrypted-only",
  verifiedAt: new Date(),
  createdByUserId: userId,
};
function input() {
  const now = Date.now();
  return {
    idempotencyKey: randomUUID(),
    payByTime: new Date(now + 3_600_000).toISOString(),
    submitResultTime: new Date(now + 7_200_000).toISOString(),
    unlockTime: new Date(now + 10_800_000).toISOString(),
    externalDisputeUnlockTime: new Date(now + 14_400_000).toISOString(),
  };
}
async function task() {
  const row = await prisma.task.create({
    data: {
      ownerId: userId,
      creatorUserId: userId,
      workspaceId,
      name: "Payment fixture",
      description: "Original input",
      assigneeId: coworkerId,
      status: TaskStatus.READY,
    },
  });
  taskIds.push(row.id);
  return row;
}

describe.runIf(process.env.RUN_DATABASE_INTEGRATION_TESTS === "true")(
  "MPS quote persistence on disposable PostgreSQL",
  () => {
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL!);
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/mps_baseline" ||
        (url.searchParams.has("host") &&
          !url.searchParams.get("host")?.startsWith("/"))
      )
        throw new Error("Disposable loopback database mps_baseline required");
      fixturesStarted = true;
      await prisma.user.create({
        data: {
          id: userId,
          name: "Payment fixture",
          email: `${userId}@fixture.invalid`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      await prisma.workspace.create({ data: { id: workspaceId, userId } });
      await prisma.vendor.create({
        data: {
          id: vendorId,
          name: "Fixture Vendor",
          slug: `fixture-${vendorId}`,
        },
      });
      await prisma.coworker.create({
        data: {
          id: coworkerId,
          vendorId,
          name: "Fixture Coworker",
          slug: `fixture-${coworkerId}`,
        },
      });
      await prisma.coworkerMpsSellerBinding.create({ data: binding });
      await prisma.creditCost.create({
        data: { unit, centsPerUnit: 10_000_000_000n },
      });
      initialTransactions = await prisma.transaction.count();
      initialClaims = await prisma.taskPaymentClaim.count();
      mps.verifySeller.mockResolvedValue(
        ok({
          ...binding,
          collectionAddress: null,
          amounts: [{ unit, amount: "100" }],
          supportedPaymentSourceIndex: undefined,
        }),
      );
      mps.createQuote.mockImplementation(async (request) => {
        const intent = await prisma.taskMpsPaymentQuote.findFirst({
          where: { inputHash: request.inputHash },
        });
        expect(intent).not.toBeNull();
        return ok({
          paymentId: randomUUID(),
          blockchainIdentifier: randomUUID(),
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
      mps.recoverQuote.mockResolvedValue(
        err({ kind: "not_found", message: "Not found" }),
      );
    });
    afterAll(async () => {
      if (!fixturesStarted) return;
      if (taskIds.length)
        await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
      await prisma.coworkerMpsSellerBinding.deleteMany({
        where: { coworkerId },
      });
      await prisma.coworker.deleteMany({ where: { id: coworkerId } });
      await prisma.vendor.deleteMany({ where: { id: vendorId } });
      await prisma.workspace.deleteMany({ where: { id: workspaceId } });
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.creditCost.deleteMany({ where: { unit } });
      await prisma.$disconnect();
    });
    it("concurrent same-key requests store one intent and make one seller POST", async () => {
      const row = await task(),
        request = input();
      const before = mps.createQuote.mock.calls.length;
      const results = await Promise.allSettled([
        createTaskMpsPaymentQuote(auth, row.id, request),
        createTaskMpsPaymentQuote(auth, row.id, request),
      ]);
      for (const result of results)
        if (result.status === "rejected")
          expect(result.reason).toMatchObject({ status: 409 });
      expect(results.some((result) => result.status === "fulfilled")).toBe(
        true,
      );
      expect(
        await prisma.taskMpsPaymentQuote.count({ where: { taskId: row.id } }),
      ).toBe(1);
      expect(mps.createQuote.mock.calls.length - before).toBe(1);
    });
    it("concurrent different ceilings cannot replace accepted consent", async () => {
      const row = await task(),
        quote = await createTaskMpsPaymentQuote(auth, row.id, input());
      const results = await Promise.allSettled(
        [100, 101].map((maxCredits) =>
          approveTaskMpsPaymentQuote(auth, row.id, quote.id, {
            termsHash: quote.termsHash!,
            maxCredits,
          }),
        ),
      );
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === "rejected"),
      ).toHaveLength(1);
      const saved = await prisma.taskMpsPaymentQuote.findUniqueOrThrow({
        where: { id: quote.id },
      });
      expect(saved.approvedByUserId).toBe(userId);
      expect(saved.approvedAt).not.toBeNull();
      expect(saved.consumedAt).toBeNull();
      expect(saved.claimId).toBeNull();
      expect(await prisma.transaction.count()).toBe(initialTransactions);
      expect(await prisma.taskPaymentClaim.count()).toBe(initialClaims);
    });
    it("enforces one active seller binding but preserves revoked versions", async () => {
      await expect(
        prisma.coworkerMpsSellerBinding.create({
          data: { ...binding, id: randomUUID() },
        }),
      ).rejects.toMatchObject({ code: "P2002" });
      const historical = await prisma.coworkerMpsSellerBinding.create({
        data: { ...binding, id: randomUUID(), revokedAt: new Date() },
      });
      expect(
        await prisma.coworkerMpsSellerBinding.count({ where: { coworkerId } }),
      ).toBe(2);
      expect(historical.encryptedApiKey).toBe("encrypted-only");
    });
    it("deleting an unfunded Task removes its quote and retains recovery credentials", async () => {
      const row = await task(),
        quote = await createTaskMpsPaymentQuote(auth, row.id, input());
      await prisma.task.delete({ where: { id: row.id } });
      expect(
        await prisma.taskMpsPaymentQuote.findUnique({
          where: { id: quote.id },
        }),
      ).toBeNull();
      expect(
        await prisma.coworkerMpsSellerBinding.findUnique({
          where: { id: bindingId },
        }),
      ).not.toBeNull();
    });
  },
);
