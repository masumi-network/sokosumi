import type { CoworkerMpsSellerBinding } from "@sokosumi/database";
import { err, ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { forbidden } from "@/helpers/error";
import { createMpsSellerCredentialCipher } from "@/lib/mps-seller-credentials";
import type { UserAuthenticationContext } from "@/middleware/auth";

import {
  connectMpsSeller,
  getMpsSeller,
  revokeMpsSeller,
  sellerCredentialContext,
  toMpsSellerDto,
} from "./mps-seller.service";

const mocks = vi.hoisted(() => ({
  env: {
    NETWORK: "Preprod",
    MPS_SELLER_ENCRYPTION_SECRET: "",
    PAYMENT_API_URL: "https://buyer.example.com",
    PAYMENT_API_KEY: "buyer-private-key",
    REGISTRY_API_URL: "https://registry.example.com",
    REGISTRY_API_KEY: "registry-private-key",
  },
  requireAdmin: vi.fn(),
  createClient: vi.fn(),
  verifySeller: vi.fn(),
  transaction: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/config/env", () => ({ getEnv: () => mocks.env }));
vi.mock("@/lib/auth", () => ({ auth: {} }));
vi.mock("@/helpers/mps-payment-access", () => ({
  requireMpsSellerAdmin: mocks.requireAdmin,
}));
vi.mock("@sokosumi/masumi/clients", () => ({
  createMpsSellerClient: mocks.createClient,
}));
vi.mock("@/lib/db/transaction", () => ({
  serializableTransaction: mocks.transaction,
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    coworkerMpsSellerBinding: { findFirst: mocks.findFirst },
  },
}));

const secret = "seller-private-key";
const cipherConfig = JSON.stringify({
  activeKeyId: "test-key",
  keys: { "test-key": Buffer.alloc(32, 7).toString("base64") },
});
const auth: UserAuthenticationContext = {
  actor: "user",
  userId: "vendor-admin",
  organizationId: null,
  role: "user",
};
const input = {
  apiUrl: "https://seller.example.com/",
  apiKey: secret,
  agentIdentifier: "ab".repeat(35),
  walletId: "wallet-1",
  paymentSourceId: "source-1",
};
const now = new Date("2026-09-30T10:00:00.000Z");
const binding: CoworkerMpsSellerBinding = {
  id: "binding-1",
  createdAt: now,
  coworkerId: "coworker-1",
  vendorId: "vendor-1",
  network: "Preprod",
  apiUrl: "https://seller.example.com",
  agentIdentifier: input.agentIdentifier,
  walletId: input.walletId,
  paymentSourceId: input.paymentSourceId,
  apiKeyId: "scoped-key-1",
  sellerVkey: "ab".repeat(28),
  walletAddress: "addr_test1_seller",
  sellerReturnAddress: "addr_test1_collection",
  policyId: "ab".repeat(28),
  paymentSourceType: "Web3CardanoV2",
  smartContractAddress: "addr_test1_contract",
  supportedPaymentSourceIndex: null,
  encryptedApiKey: "previous-protected-credential",
  verifiedAt: now,
  createdByUserId: auth.userId,
  revokedAt: null,
};
const tx = {
  coworkerMpsSellerBinding: {
    findFirst: mocks.findFirst,
    create: mocks.create,
    updateMany: mocks.updateMany,
    update: mocks.update,
  },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.env.MPS_SELLER_ENCRYPTION_SECRET = cipherConfig;
  mocks.requireAdmin.mockResolvedValue({
    id: binding.coworkerId,
    vendorId: binding.vendorId,
  });
  mocks.createClient.mockReturnValue({ verifySeller: mocks.verifySeller });
  mocks.verifySeller.mockResolvedValue(
    ok({
      ...binding,
      collectionAddress: binding.sellerReturnAddress,
    }),
  );
  mocks.transaction.mockImplementation(
    async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
  );
  mocks.findFirst.mockResolvedValue(binding);
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.create.mockImplementation(
    async ({ data }: { data: Partial<CoworkerMpsSellerBinding> }) => ({
      ...binding,
      ...data,
    }),
  );
  mocks.update.mockImplementation(
    async ({ data }: { data: Partial<CoworkerMpsSellerBinding> }) => ({
      ...binding,
      ...data,
    }),
  );
});

describe("connectMpsSeller", () => {
  it("checks Vendor admin access before contacting either node", async () => {
    mocks.requireAdmin.mockRejectedValue(
      forbidden("Vendor admin access required"),
    );
    await expect(
      connectMpsSeller(auth, binding.coworkerId, input),
    ).rejects.toMatchObject({ status: 403 });
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.verifySeller).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("checks authority again inside the write transaction", async () => {
    mocks.requireAdmin
      .mockResolvedValueOnce({
        id: binding.coworkerId,
        vendorId: binding.vendorId,
      })
      .mockRejectedValueOnce(forbidden("Vendor admin access required"));
    await expect(
      connectMpsSeller(auth, binding.coworkerId, input),
    ).rejects.toMatchObject({ status: 403 });
    expect(mocks.verifySeller).toHaveBeenCalledTimes(1);
    expect(mocks.requireAdmin).toHaveBeenLastCalledWith(
      auth,
      binding.coworkerId,
      tx,
    );
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a Vendor change during verification", async () => {
    mocks.requireAdmin
      .mockResolvedValueOnce({
        id: binding.coworkerId,
        vendorId: binding.vendorId,
      })
      .mockResolvedValueOnce({
        id: binding.coworkerId,
        vendorId: "other-vendor",
      });
    await expect(
      connectMpsSeller(auth, binding.coworkerId, input),
    ).rejects.toMatchObject({ status: 409 });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("requires valid encryption configuration before contacting the seller", async () => {
    mocks.env.MPS_SELLER_ENCRYPTION_SECRET = "";
    await expect(
      connectMpsSeller(auth, binding.coworkerId, input),
    ).rejects.toMatchObject({ status: 422 });
    expect(mocks.createClient).not.toHaveBeenCalled();
    mocks.env.MPS_SELLER_ENCRYPTION_SECRET = "invalid";
    await expect(
      connectMpsSeller(auth, binding.coworkerId, input),
    ).rejects.toMatchObject({ status: 500 });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("encrypts the scoped key and returns only public binding fields", async () => {
    const result = await connectMpsSeller(auth, binding.coworkerId, input);
    const stored = mocks.create.mock.calls[0]?.[0].data;
    expect(JSON.stringify(stored)).not.toContain(secret);
    const record = { ...binding, ...stored };
    expect(
      createMpsSellerCredentialCipher(cipherConfig).decrypt(
        record.encryptedApiKey,
        sellerCredentialContext(record),
      ),
    ).toBe(secret);
    expect(result.paymentsEnabled).toBe(false);
    for (const key of [
      "encryptedApiKey",
      "apiKeyId",
      "createdByUserId",
      "vendorId",
    ]) {
      expect(result).not.toHaveProperty(key);
    }
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(mocks.createClient).toHaveBeenCalledWith(
      { network: "Preprod", apiUrl: binding.apiUrl, apiKey: secret },
      { apiUrl: mocks.env.PAYMENT_API_URL, apiKey: mocks.env.PAYMENT_API_KEY },
      {
        apiUrl: mocks.env.REGISTRY_API_URL,
        apiKey: mocks.env.REGISTRY_API_KEY,
      },
    );
  });

  it("revokes the old binding without erasing its credential", async () => {
    await connectMpsSeller(auth, binding.coworkerId, input);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        coworkerId: binding.coworkerId,
        network: binding.network,
        revokedAt: null,
      },
      data: { revokedAt: expect.any(Date) },
    });
    expect(mocks.create.mock.calls[0]?.[0].data.id).not.toBe(binding.id);
    expect(mocks.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.create.mock.invocationCallOrder[0],
    );
  });

  it("does not expose malicious node responses containing either node credential", async () => {
    mocks.verifySeller.mockResolvedValue(
      err({
        message: `${secret} ${mocks.env.PAYMENT_API_KEY} ${mocks.env.REGISTRY_API_KEY}`,
        response: {
          apiKey: secret,
          nested: { message: mocks.env.PAYMENT_API_KEY },
        },
      }),
    );
    const result = await connectMpsSeller(
      auth,
      binding.coworkerId,
      input,
    ).catch((error: unknown) => error);
    expect(result).toMatchObject({
      status: 422,
      message: "MPS seller verification failed",
    });
    const text = String(result) + JSON.stringify(result);
    for (const key of [
      secret,
      mocks.env.PAYMENT_API_KEY,
      mocks.env.REGISTRY_API_KEY,
    ]) {
      expect(text).not.toContain(key);
    }
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

describe("stored MPS seller access", () => {
  it("returns null when there is no active binding", async () => {
    mocks.findFirst.mockResolvedValue(null);
    await expect(getMpsSeller(auth, binding.coworkerId)).resolves.toBeNull();
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: {
        coworkerId: binding.coworkerId,
        network: "Preprod",
        revokedAt: null,
      },
    });
  });

  it("uses the same explicit DTO allowlist for stored bindings", async () => {
    await expect(getMpsSeller(auth, binding.coworkerId)).resolves.toEqual(
      toMpsSellerDto(binding),
    );
    expect(JSON.stringify(toMpsSellerDto(binding))).not.toContain(
      binding.encryptedApiKey,
    );
  });

  it("returns a revoked old binding without revoking a replacement", async () => {
    const revoked = { ...binding, revokedAt: now };
    mocks.findFirst.mockResolvedValue(revoked);
    await expect(
      revokeMpsSeller(auth, binding.coworkerId, binding.id),
    ).resolves.toEqual(toMpsSellerDto(revoked));
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: {
        id: binding.id,
        coworkerId: binding.coworkerId,
        network: "Preprod",
      },
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("revokes only the specified active binding and retains its credential", async () => {
    const result = await revokeMpsSeller(auth, binding.coworkerId, binding.id);
    expect(result.revokedAt).not.toBeNull();
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: binding.id },
      data: { revokedAt: expect.any(Date) },
    });
    expect(mocks.requireAdmin).toHaveBeenCalledWith(
      auth,
      binding.coworkerId,
      tx,
    );
  });

  it("rejects revocation when the binding does not belong to this Coworker", async () => {
    mocks.findFirst.mockResolvedValue(null);
    await expect(
      revokeMpsSeller(auth, binding.coworkerId, "foreign-binding"),
    ).rejects.toMatchObject({ status: 404 });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
