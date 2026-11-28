import { randomBytes } from "node:crypto";

import type {
  CreditBucketReferenceType,
  Prisma,
} from "../generated/prisma/client.js";
import { netTable, netType, type TableNetwork } from "../sql-tables.js";

/**
 * RFC 9562 UUIDv7 with a 31-bit monotonic sequence within a millisecond
 * (12 bits of rand_a + 19 bits of rand_b): over 10^9 ordered IDs per ms,
 * with embedded timestamp never exceeding the caller's clock.
 */
let lastMsecs = -1;
let lastSeq = 0;

export function mintMonotonicUuidV7(): string {
  const bytes = randomBytes(16);
  let msecs = Date.now();

  if (msecs === lastMsecs) {
    lastSeq += 1;
    if (lastSeq > 0x7fffffff) {
      msecs += 1;
      lastMsecs = msecs;
      lastSeq = 0;
    }
  } else {
    // New millisecond (including fake-timer jumps in tests): start in the
    // lower half of the 31-bit sequence space so >10^9 same-ms increments fit.
    lastMsecs = msecs;
    lastSeq =
      (((bytes[6] ?? 0) << 24) |
        ((bytes[7] ?? 0) << 16) |
        ((bytes[8] ?? 0) << 8) |
        (bytes[9] ?? 0)) &
      0x3fffffff;
  }

  const hi = Math.floor(msecs / 0x10000);
  const lo = msecs & 0xffff;
  bytes[0] = (hi >>> 24) & 0xff;
  bytes[1] = (hi >>> 16) & 0xff;
  bytes[2] = (hi >>> 8) & 0xff;
  bytes[3] = hi & 0xff;
  bytes[4] = (lo >>> 8) & 0xff;
  bytes[5] = lo & 0xff;

  // Version 7 + top 12 bits of the 31-bit sequence.
  bytes[6] = 0x70 | ((lastSeq >>> 27) & 0x0f);
  bytes[7] = (lastSeq >>> 19) & 0xff;
  // RFC 9562 variant (10xxxxxx) + remaining 19 bits of the sequence.
  bytes[8] = 0x80 | ((lastSeq >>> 13) & 0x3f);
  bytes[9] = (lastSeq >>> 5) & 0xff;
  bytes[10] = ((lastSeq & 0x1f) << 3) | ((bytes[10] ?? 0) & 0x07);

  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export async function findCreditBucketByReference(
  params: {
    network?: TableNetwork;
    referenceId: string;
    referenceType: CreditBucketReferenceType;
  },
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
): Promise<{
  activatesAt: Date | null;
  expiresAt: Date | null;
  id: string;
} | null> {
  const network = params.network ?? "mainnet";
  const rows = await tx.$queryRaw<
    Array<{
      activatesAt: Date | null;
      expiresAt: Date | null;
      id: string;
    }>
  >`
    SELECT id, "activatesAt", "expiresAt"
    FROM ${netTable(network, "credit_bucket")}
    WHERE "referenceId" = ${params.referenceId}
      AND "referenceType" = CAST(${params.referenceType}::text AS ${netType(network, "CreditBucketReferenceType")})
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export interface InsertCreditGrantParams {
  network?: TableNetwork;
  /** Optional stateful UUIDv7 allocator; defaults to the built-in monotonic v7 generator. */
  mintId?: () => string;
  amount: bigint;
  userId: string | null;
  organizationId: string | null;
  /** Defaults to `userId`; override when bucket and transaction actors differ. */
  transactionUserId?: string | null;
  activatesAt?: Date | null;
  expiresAt: Date | null;
  projectId?: string | null;
  referenceId: string;
  referenceType: CreditBucketReferenceType;
  referenceNote?: string | null;
}

/**
 * Writes one positive grant Transaction and its CreditBucket on `network`
 * using qualified raw SQL on the caller's transaction. Mints monotonic UUIDv7
 * IDs before reading `new Date()` so ID timestamps never exceed `createdAt`,
 * and Transaction and CreditBucket share one `createdAt`/`updatedAt` instant.
 */
export async function insertCreditGrant(
  params: InsertCreditGrantParams,
  tx: Pick<Prisma.TransactionClient, "$executeRaw">,
): Promise<{ bucketId: string; transactionId: string }> {
  const network = params.network ?? "mainnet";
  const mint = params.mintId ?? mintMonotonicUuidV7;
  const transactionId = mint();
  const bucketId = mint();
  const now = new Date();
  const transactionUserId =
    params.transactionUserId === undefined
      ? params.userId
      : params.transactionUserId;
  const activatesAt = params.activatesAt ?? null;
  const referenceNote = params.referenceNote ?? null;
  const projectId = params.projectId ?? null;

  await tx.$executeRaw`
    INSERT INTO ${netTable(network, "Transaction")}
      (id, "createdAt", "updatedAt", amount, "userId", "organizationId")
    VALUES (
      ${transactionId},
      ${now},
      ${now},
      ${params.amount},
      ${transactionUserId},
      ${params.organizationId}
    )
  `;

  await tx.$executeRaw`
    INSERT INTO ${netTable(network, "credit_bucket")}
      (id, "createdAt", "updatedAt", amount, "expiresAt", "activatesAt", "referenceId", "referenceType", "referenceNote", "sourceTransactionId", "userId", "organizationId", "projectId")
    VALUES (
      ${bucketId},
      ${now},
      ${now},
      ${params.amount},
      ${params.expiresAt},
      ${activatesAt},
      ${params.referenceId},
      CAST(${params.referenceType}::text AS ${netType(network, "CreditBucketReferenceType")}),
      ${referenceNote},
      ${transactionId},
      ${params.userId},
      ${params.organizationId},
      CAST(${projectId}::text AS uuid)
    )
  `;

  return { bucketId, transactionId };
}
