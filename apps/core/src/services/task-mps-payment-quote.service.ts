import { createHash, randomBytes } from "node:crypto";

import {
  type CoworkerMpsSellerBinding,
  Prisma,
  type TaskMpsPaymentQuote,
  TaskStatus,
} from "@sokosumi/database";
import { hashInput } from "@sokosumi/masumi/hash";
import { convertCentsToCredits, convertCreditsToCents } from "@sokosumi/utils";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";

import { LIMITS } from "@/config/constants";
import { getEnv } from "@/config/env";
import { getCreditCostsOrThrow } from "@/helpers/agent";
import { calculateCentsFromMasumiAmountStrings } from "@/helpers/agent-cost";
import { conflict, notFound, unprocessableEntity } from "@/helpers/error";
import { requireTaskPaymentOwner } from "@/helpers/mps-payment-access";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  type AuthenticationContext,
  requireUserAuthContext,
} from "@/middleware/auth";
import {
  type approveMpsQuoteSchema,
  type createMpsQuoteSchema,
  mpsQuoteTermsSchema,
  taskMpsPaymentQuoteSchema,
} from "@/schemas/task-mps-payment-quote.schema";

import {
  sellerCipher,
  sellerClient,
  sellerCredentialContext,
} from "./mps-seller.service";

const QUOTE_TTL_MS = 15 * 60 * 1000;
const storedRequestSchema = z.object({
  agentIdentifier: z.string(),
  walletId: z.string(),
  paymentSourceId: z.string(),
  inputHash: z.string(),
  identifierFromPurchaser: z.string(),
  metadata: z.string(),
  sellerReturnAddress: z.string().nullable(),
  sellerVkey: z.string(),
  paymentSourceType: z.enum(["Web3CardanoV1", "Web3CardanoV2"]),
  smartContractAddress: z.string(),
  supportedPaymentSourceIndex: z.number().int().optional(),
  amounts: z.array(z.object({ unit: z.string(), amount: z.string() })),
  payByTime: z.string(),
  submitResultTime: z.string(),
  unlockTime: z.string(),
  externalDisputeUnlockTime: z.string(),
});

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function taskInputHash(
  task: { id: string; name: string; description: string | null },
  purchaser: string,
) {
  const value = hashInput(
    JSON.stringify({
      taskId: task.id,
      name: task.name,
      description: task.description,
    }),
    purchaser,
  );
  if (!value) throw unprocessableEntity("Task input could not be hashed");
  return value;
}

export function toTaskMpsPaymentQuoteDto(quote: TaskMpsPaymentQuote) {
  return taskMpsPaymentQuoteSchema.parse({
    id: quote.id,
    taskId: quote.taskId,
    coworkerId: quote.coworkerId,
    sellerBindingId: quote.sellerBindingId,
    billingOwnerId: quote.billingOwnerId,
    billingOrganizationId: quote.billingOrganizationId,
    network: quote.network,
    state: quote.consumedAt
      ? "consumed"
      : quote.revokedAt
        ? "revoked"
        : quote.expiresAt.getTime() <= Date.now()
          ? "expired"
          : quote.approvedAt
            ? "approved"
            : quote.quotedAt
              ? "quoted"
              : "unresolved",
    inputHash: quote.inputHash,
    termsHash: quote.termsHash,
    terms:
      quote.quotedTerms === null
        ? null
        : mpsQuoteTermsSchema.parse(quote.quotedTerms),
    quotedCredits:
      quote.quotedCents === null
        ? null
        : convertCentsToCredits(quote.quotedCents),
    maxCredits:
      quote.maxCents === null ? null : convertCentsToCredits(quote.maxCents),
    expiresAt: quote.expiresAt,
    approvedAt: quote.approvedAt,
    revokedAt: quote.revokedAt,
    consumedAt: quote.consumedAt,
    paymentsEnabled: false,
  });
}

async function requireCurrentQuote(
  auth: AuthenticationContext,
  taskId: string,
  quoteId: string,
  tx: Prisma.TransactionClient = prisma,
) {
  const task = await requireTaskPaymentOwner(auth, taskId, tx);
  const quote = await tx.taskMpsPaymentQuote.findFirst({
    where: { id: quoteId, taskId },
  });
  if (!quote) throw notFound("Task payment quote not found");
  if (
    quote.billingOwnerId !== task.ownerId ||
    quote.billingOrganizationId !== task.organizationId ||
    quote.coworkerId !== task.assigneeId ||
    quote.network !== getEnv().NETWORK
  ) {
    throw conflict(
      "Task billing identity or Coworker changed; request a new quote",
    );
  }
  return { task, quote };
}

async function requireActiveBinding(
  bindingId: string,
  coworkerId: string,
  tx: Prisma.TransactionClient = prisma,
) {
  const binding = await tx.coworkerMpsSellerBinding.findFirst({
    where: {
      id: bindingId,
      coworkerId,
      network: getEnv().NETWORK,
      revokedAt: null,
      coworker: { archivedAt: null },
    },
    include: { coworker: { select: { vendorId: true } } },
  });
  if (!binding || binding.vendorId !== binding.coworker.vendorId)
    throw conflict("Seller configuration changed; request a new quote");
  return binding;
}

function clientForBinding(binding: CoworkerMpsSellerBinding) {
  const apiKey = sellerCipher().decrypt(
    binding.encryptedApiKey,
    sellerCredentialContext(binding),
  );
  return sellerClient(binding.apiUrl, apiKey);
}

function requireUnusedQuote(quote: TaskMpsPaymentQuote) {
  if (
    quote.revokedAt ||
    quote.consumedAt ||
    quote.expiresAt.getTime() <= Date.now()
  )
    throw conflict("Task payment quote is revoked, consumed, or expired");
}

export async function createTaskMpsPaymentQuote(
  auth: AuthenticationContext,
  taskId: string,
  input: z.infer<typeof createMpsQuoteSchema>,
) {
  const { idempotencyKey } = input;
  const task = await requireTaskPaymentOwner(auth, taskId);
  if (
    task.status === TaskStatus.COMPLETED ||
    task.status === TaskStatus.CANCELED
  )
    throw conflict("Completed or canceled Tasks cannot request payment quotes");
  const existing = await prisma.taskMpsPaymentQuote.findUnique({
    where: { taskId_idempotencyKey: { taskId, idempotencyKey } },
  });
  const deadlines = {
    payByTime: String(Date.parse(input.payByTime)),
    submitResultTime: String(Date.parse(input.submitResultTime)),
    unlockTime: String(Date.parse(input.unlockTime)),
    externalDisputeUnlockTime: String(
      Date.parse(input.externalDisputeUnlockTime),
    ),
  };
  if (existing) {
    const stored = storedRequestSchema.parse(existing.requestPayload);
    if (
      Object.entries(deadlines).some(
        ([key, value]) => stored[key as keyof typeof deadlines] !== value,
      )
    )
      throw conflict("Quote request ID already has different deadlines");
    return completeTaskMpsPaymentQuote(auth, taskId, existing.id, false);
  }
  const times = [Date.now(), ...Object.values(deadlines).map(Number)];
  if (
    times.some(
      (time, index) =>
        !Number.isSafeInteger(time) || (index > 0 && time <= times[index - 1]),
    )
  )
    throw unprocessableEntity(
      "Payment deadlines must be in the future and ordered: pay, result, unlock, dispute unlock",
    );
  if (
    Number(deadlines.submitResultTime) < Date.now() + 15 * 60_000 ||
    Number(deadlines.submitResultTime) - Number(deadlines.payByTime) <
      5 * 60_000 ||
    Number(deadlines.unlockTime) - Number(deadlines.submitResultTime) <
      15 * 60_000 ||
    Number(deadlines.externalDisputeUnlockTime) - Number(deadlines.unlockTime) <
      15 * 60_000
  )
    throw unprocessableEntity(
      "Payment deadlines require a result at least 15 minutes ahead and minimum gaps of 5, 15, and 15 minutes",
    );
  const selected = await prisma.coworkerMpsSellerBinding.findFirst({
    where: {
      coworkerId: task.assigneeId,
      network: getEnv().NETWORK,
      revokedAt: null,
    },
  });
  if (!selected) throw unprocessableEntity("Coworker has no active MPS seller");
  const binding = await requireActiveBinding(selected.id, task.assigneeId);
  const verifiedResult = await clientForBinding(binding).verifySeller(binding);
  if (verifiedResult.isErr())
    throw unprocessableEntity("MPS seller verification failed");
  const verified = verifiedResult.value;
  if (
    verified.apiKeyId !== binding.apiKeyId ||
    verified.sellerVkey !== binding.sellerVkey ||
    verified.walletAddress !== binding.walletAddress ||
    verified.collectionAddress !== binding.sellerReturnAddress ||
    verified.smartContractAddress !== binding.smartContractAddress ||
    verified.paymentSourceType !== binding.paymentSourceType
  ) {
    throw conflict("Seller configuration changed; reconnect the seller");
  }
  if (
    verified.paymentSourceType === "Web3CardanoV2" &&
    verified.supportedPaymentSourceIndex === undefined
  )
    throw unprocessableEntity(
      "The V2 payment source index could not be verified",
    );
  const quoteId = uuidv7();
  const identifierFromPurchaser = randomBytes(10).toString("hex");
  const inputHash = taskInputHash(task, identifierFromPurchaser);
  const request = storedRequestSchema.parse({
    ...deadlines,
    agentIdentifier: binding.agentIdentifier,
    walletId: binding.walletId,
    paymentSourceId: binding.paymentSourceId,
    sellerVkey: binding.sellerVkey,
    inputHash,
    identifierFromPurchaser,
    metadata: JSON.stringify({
      sokosumiTaskId: taskId,
      sokosumiQuoteId: quoteId,
    }),
    sellerReturnAddress: binding.sellerReturnAddress,
    paymentSourceType: binding.paymentSourceType,
    smartContractAddress: binding.smartContractAddress,
    supportedPaymentSourceIndex: verified.supportedPaymentSourceIndex,
    amounts: verified.amounts,
  });
  const saved = await serializableTransaction(async (tx) => {
    const current = await requireTaskPaymentOwner(auth, taskId, tx);
    await requireActiveBinding(binding.id, current.assigneeId, tx);
    if (
      current.ownerId !== task.ownerId ||
      current.organizationId !== task.organizationId ||
      taskInputHash(current, identifierFromPurchaser) !== inputHash
    )
      throw conflict("Task changed while requesting a quote");
    const duplicate = await tx.taskMpsPaymentQuote.findUnique({
      where: { taskId_idempotencyKey: { taskId, idempotencyKey } },
    });
    if (duplicate) {
      const stored = storedRequestSchema.parse(duplicate.requestPayload);
      if (
        Object.entries(deadlines).some(
          ([key, value]) => stored[key as keyof typeof deadlines] !== value,
        )
      )
        throw conflict("Quote request ID already has different deadlines");
      return { id: duplicate.id, created: false };
    }
    const quote = await tx.taskMpsPaymentQuote.create({
      data: {
        id: quoteId,
        taskId,
        sellerBindingId: binding.id,
        coworkerId: current.assigneeId,
        billingOwnerId: current.ownerId,
        billingOrganizationId: current.organizationId,
        network: getEnv().NETWORK,
        idempotencyKey,
        inputHash,
        identifierFromPurchaser,
        requestPayload: request,
        expiresAt: new Date(
          Math.min(Date.now() + QUOTE_TTL_MS, Number(deadlines.payByTime)),
        ),
      },
    });
    return { id: quote.id, created: true };
  }, "Task payment quote changed concurrently. Please retry.");
  // A durable intent precedes the only POST. Every subsequent attempt is read-only recovery.
  return completeTaskMpsPaymentQuote(auth, taskId, saved.id, saved.created);
}

async function completeTaskMpsPaymentQuote(
  auth: AuthenticationContext,
  taskId: string,
  quoteId: string,
  create: boolean,
) {
  const { quote } = await requireCurrentQuote(auth, taskId, quoteId);
  if (
    quote.quotedAt ||
    quote.revokedAt ||
    quote.expiresAt.getTime() <= Date.now()
  )
    return toTaskMpsPaymentQuoteDto(quote);
  const binding = await requireActiveBinding(
    quote.sellerBindingId,
    quote.coworkerId,
  );
  const request = storedRequestSchema.parse(quote.requestPayload);
  const client = clientForBinding(binding);
  const result = create
    ? await client.createQuote(request)
    : await client.recoverQuote(request);
  if (result.isErr()) {
    if (result.error.kind === "rejected")
      throw unprocessableEntity(
        "MPS seller rejected the quote request; inspect seller setup and payment deadlines",
      );
    return toTaskMpsPaymentQuoteDto(quote);
  }
  const terms = mpsQuoteTermsSchema.parse(result.value);
  const payByTime = Number(terms.payByTime);
  if (!Number.isSafeInteger(payByTime) || payByTime <= Date.now())
    throw unprocessableEntity("MPS quote has expired");
  return serializableTransaction(async (tx) => {
    const current = await requireCurrentQuote(auth, taskId, quoteId, tx);
    requireUnusedQuote(current.quote);
    await requireActiveBinding(binding.id, current.task.assigneeId, tx);
    if (
      taskInputHash(current.task, quote.identifierFromPurchaser) !==
      quote.inputHash
    )
      throw conflict("Task input changed; request a new quote");
    if (current.quote.quotedAt) return toTaskMpsPaymentQuoteDto(current.quote);
    const cents = calculateCentsFromMasumiAmountStrings(
      terms.Amounts,
      await getCreditCostsOrThrow(tx),
    );
    if (
      convertCentsToCredits(cents) < LIMITS.MIN_CHARGEABLE_CREDITS ||
      cents > 9_223_372_036_854_775_807n
    )
      throw unprocessableEntity(
        "MPS quote amount is outside supported credit limits",
      );
    const saved = await tx.taskMpsPaymentQuote.update({
      where: { id: quoteId },
      data: {
        quotedTerms: terms,
        blockchainIdentifierHash: digest(
          terms.blockchainIdentifier.toLowerCase(),
        ),
        termsHash: digest(JSON.stringify(terms)),
        quotedCents: cents,
        quotedAt: new Date(),
        expiresAt: new Date(Math.min(quote.expiresAt.getTime(), payByTime)),
      },
    });
    return toTaskMpsPaymentQuoteDto(saved);
  }, "Task payment quote changed concurrently. Please retry.");
}

export async function getTaskMpsPaymentQuote(
  auth: AuthenticationContext,
  taskId: string,
  quoteId: string,
) {
  return toTaskMpsPaymentQuoteDto(
    (await requireCurrentQuote(auth, taskId, quoteId)).quote,
  );
}

export async function approveTaskMpsPaymentQuote(
  auth: AuthenticationContext,
  taskId: string,
  quoteId: string,
  input: z.infer<typeof approveMpsQuoteSchema>,
) {
  const user = requireUserAuthContext(auth);
  return serializableTransaction(async (tx) => {
    const { task, quote } = await requireCurrentQuote(
      auth,
      taskId,
      quoteId,
      tx,
    );
    requireUnusedQuote(quote);
    await requireActiveBinding(quote.sellerBindingId, quote.coworkerId, tx);
    if (
      task.status === TaskStatus.COMPLETED ||
      task.status === TaskStatus.CANCELED ||
      taskInputHash(task, quote.identifierFromPurchaser) !== quote.inputHash
    )
      throw conflict("Task input or status changed; request a new quote");
    if (
      !quote.quotedAt ||
      !quote.quotedTerms ||
      quote.termsHash !== input.termsHash
    )
      throw conflict("Review the current quote terms before approval");
    const terms = mpsQuoteTermsSchema.parse(quote.quotedTerms);
    if (digest(JSON.stringify(terms)) !== quote.termsHash)
      throw conflict("Stored quote terms do not match approval");
    const maxCents = convertCreditsToCents(input.maxCredits);
    const cents = calculateCentsFromMasumiAmountStrings(
      terms.Amounts,
      await getCreditCostsOrThrow(tx),
    );
    if (cents <= 0n || cents > maxCents)
      throw unprocessableEntity("Quote exceeds the approved credit ceiling");
    if (quote.approvedAt) {
      if (quote.maxCents !== maxCents)
        throw conflict(
          "Approved credit ceiling cannot be changed; request a new quote",
        );
      return toTaskMpsPaymentQuoteDto(quote);
    }
    return toTaskMpsPaymentQuoteDto(
      await tx.taskMpsPaymentQuote.update({
        where: { id: quoteId },
        data: {
          approvedAt: new Date(),
          approvedByUserId: user.userId,
          maxCents,
        },
      }),
    );
  }, "Task payment quote changed concurrently. Please retry.");
}

export async function revokeTaskMpsPaymentQuote(
  auth: AuthenticationContext,
  taskId: string,
  quoteId: string,
) {
  return serializableTransaction(async (tx) => {
    const { quote } = await requireCurrentQuote(auth, taskId, quoteId, tx);
    if (quote.consumedAt) throw conflict("A consumed quote cannot be revoked");
    if (quote.revokedAt) return toTaskMpsPaymentQuoteDto(quote);
    return toTaskMpsPaymentQuoteDto(
      await tx.taskMpsPaymentQuote.update({
        where: { id: quoteId },
        data: { revokedAt: new Date() },
      }),
    );
  }, "Task payment quote changed concurrently. Please retry.");
}
