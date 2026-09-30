import type { CoworkerMpsSellerBinding } from "@sokosumi/database";
import { createMpsSellerClient } from "@sokosumi/masumi/clients";
import { v7 as uuidv7 } from "uuid";
import type { z } from "zod";

import { getEnv } from "@/config/env";
import { conflict, notFound, unprocessableEntity } from "@/helpers/error";
import { requireMpsSellerAdmin } from "@/helpers/mps-payment-access";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  createMpsSellerCredentialCipher,
  type MpsSellerCredentialContext,
} from "@/lib/mps-seller-credentials";
import {
  type AuthenticationContext,
  requireUserAuthContext,
} from "@/middleware/auth";
import {
  type connectMpsSellerSchema,
  mpsSellerSchema,
} from "@/schemas/mps-seller.schema";

export function sellerCredentialContext(
  binding: CoworkerMpsSellerBinding,
): MpsSellerCredentialContext {
  return {
    bindingId: binding.id,
    coworkerId: binding.coworkerId,
    vendorId: binding.vendorId,
    network: mpsSellerSchema.shape.network.parse(binding.network),
    apiUrl: binding.apiUrl,
    agentIdentifier: binding.agentIdentifier,
    walletId: binding.walletId,
    paymentSourceId: binding.paymentSourceId,
    apiKeyId: binding.apiKeyId,
  };
}

export function sellerCipher() {
  const secret = getEnv().MPS_SELLER_ENCRYPTION_SECRET;
  if (!secret)
    throw unprocessableEntity(
      "MPS seller setup is not configured on this deployment",
    );
  return createMpsSellerCredentialCipher(secret);
}

export function sellerClient(apiUrl: string, apiKey: string) {
  const env = getEnv();
  return createMpsSellerClient(
    { network: env.NETWORK, apiUrl, apiKey },
    { apiUrl: env.PAYMENT_API_URL, apiKey: env.PAYMENT_API_KEY },
    { apiUrl: env.REGISTRY_API_URL, apiKey: env.REGISTRY_API_KEY },
  );
}

export function toMpsSellerDto(binding: CoworkerMpsSellerBinding) {
  // Parse an explicit allowlist. Credentials and creator/key identities never leave Core.
  return mpsSellerSchema.parse({
    id: binding.id,
    coworkerId: binding.coworkerId,
    network: binding.network,
    apiUrl: binding.apiUrl,
    agentIdentifier: binding.agentIdentifier,
    walletId: binding.walletId,
    paymentSourceId: binding.paymentSourceId,
    sellerVkey: binding.sellerVkey,
    walletAddress: binding.walletAddress,
    sellerReturnAddress: binding.sellerReturnAddress,
    paymentSourceType: binding.paymentSourceType,
    smartContractAddress: binding.smartContractAddress,
    verifiedAt: binding.verifiedAt,
    revokedAt: binding.revokedAt,
    paymentsEnabled: false,
  });
}

export async function connectMpsSeller(
  auth: AuthenticationContext,
  coworkerId: string,
  input: z.infer<typeof connectMpsSellerSchema>,
) {
  const user = requireUserAuthContext(auth);
  const coworker = await requireMpsSellerAdmin(auth, coworkerId);
  const cipher = sellerCipher();
  const apiUrl = input.apiUrl.replace(/\/+$/u, "");
  const result = await sellerClient(apiUrl, input.apiKey).verifySeller(input);
  if (result.isErr())
    throw unprocessableEntity("MPS seller verification failed");
  const verified = result.value;
  const context: MpsSellerCredentialContext = {
    bindingId: uuidv7(),
    coworkerId,
    vendorId: coworker.vendorId,
    network: getEnv().NETWORK,
    apiUrl,
    agentIdentifier: verified.agentIdentifier,
    walletId: verified.walletId,
    paymentSourceId: verified.paymentSourceId,
    apiKeyId: verified.apiKeyId,
  };
  const encryptedApiKey = cipher.encrypt(input.apiKey, context);
  return serializableTransaction(async (tx) => {
    const current = await requireMpsSellerAdmin(auth, coworkerId, tx);
    if (current.vendorId !== coworker.vendorId)
      throw conflict("Coworker Vendor changed during seller verification");
    const now = new Date();
    await tx.coworkerMpsSellerBinding.updateMany({
      where: { coworkerId, network: context.network, revokedAt: null },
      data: { revokedAt: now },
    });
    const binding = await tx.coworkerMpsSellerBinding.create({
      data: {
        id: context.bindingId,
        coworkerId,
        vendorId: context.vendorId,
        network: context.network,
        apiUrl,
        agentIdentifier: context.agentIdentifier,
        walletId: context.walletId,
        paymentSourceId: context.paymentSourceId,
        apiKeyId: context.apiKeyId,
        sellerVkey: verified.sellerVkey,
        walletAddress: verified.walletAddress,
        sellerReturnAddress: verified.collectionAddress,
        policyId: verified.policyId,
        paymentSourceType: verified.paymentSourceType,
        smartContractAddress: verified.smartContractAddress,
        supportedPaymentSourceIndex:
          verified.supportedPaymentSourceIndex ?? null,
        encryptedApiKey,
        verifiedAt: now,
        createdByUserId: user.userId,
      },
    });
    return toMpsSellerDto(binding);
  }, "Seller configuration changed concurrently. Please retry.");
}

export async function getMpsSeller(
  auth: AuthenticationContext,
  coworkerId: string,
) {
  await requireMpsSellerAdmin(auth, coworkerId);
  const binding = await prisma.coworkerMpsSellerBinding.findFirst({
    where: { coworkerId, network: getEnv().NETWORK, revokedAt: null },
  });
  return binding ? toMpsSellerDto(binding) : null;
}

export async function revokeMpsSeller(
  auth: AuthenticationContext,
  coworkerId: string,
  bindingId: string,
) {
  return serializableTransaction(async (tx) => {
    await requireMpsSellerAdmin(auth, coworkerId, tx);
    const binding = await tx.coworkerMpsSellerBinding.findFirst({
      where: { id: bindingId, coworkerId, network: getEnv().NETWORK },
    });
    if (!binding) throw notFound("MPS seller binding not found");
    if (binding.revokedAt) return toMpsSellerDto(binding);
    return toMpsSellerDto(
      await tx.coworkerMpsSellerBinding.update({
        where: { id: binding.id },
        data: { revokedAt: new Date() },
      }),
    );
  }, "Seller configuration changed concurrently. Please retry.");
}
