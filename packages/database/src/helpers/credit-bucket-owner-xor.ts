import {
  CreditBucketReferenceType,
  Prisma,
  type PrismaClient,
} from "../generated/prisma/client.js";
import { ORGANIZATION_MEMBER_SUBSCRIPTION_REFERENCE_PREFIX } from "./credit.js";

export const CREDIT_BUCKET_OWNER_XOR_CLASSES = {
  personal: "personal",
  org: "org",
  leftover_member_period_rem0: "leftover_member_period_rem0",
  leftover_member_period_rem_gt0: "leftover_member_period_rem_gt0",
  dual_owned_org_period: "dual_owned_org_period",
  dual_owned_non_period: "dual_owned_non_period",
  both_null_rem0: "both_null_rem0",
  both_null_rem_gt0: "both_null_rem_gt0",
} as const;

export type CreditBucketOwnerXorClass =
  (typeof CREDIT_BUCKET_OWNER_XOR_CLASSES)[keyof typeof CREDIT_BUCKET_OWNER_XOR_CLASSES];

export const CREDIT_BUCKET_OWNER_CLASS_ACTIONS = {
  personal: "keep",
  org: "keep",
  leftover_member_period_rem0: "delete",
  leftover_member_period_rem_gt0: "drain_then_delete",
  dual_owned_org_period: "null_user_id",
  dual_owned_non_period: "null_user_id",
  both_null_rem0: "delete",
  both_null_rem_gt0: "fail_closed",
} as const;

export type CreditBucketOwnerClassAction =
  (typeof CREDIT_BUCKET_OWNER_CLASS_ACTIONS)[CreditBucketOwnerXorClass];

export interface CreditBucketOwnerClassifyInput {
  organizationId: string | null;
  referenceId: string | null;
  referenceType: CreditBucketReferenceType | null;
  remaining: bigint;
  userId: string | null;
}

export interface CreditBucketOwnerXorRow
  extends CreditBucketOwnerClassifyInput {
  id: string;
}

export interface CreditBucketOwnerXorInventory {
  counts: Record<CreditBucketOwnerXorClass, number>;
  remainingCentsByClass: Record<CreditBucketOwnerXorClass, bigint>;
  rows: Array<CreditBucketOwnerXorRow & { class: CreditBucketOwnerXorClass }>;
}

export interface CreditBucketOwnerXorReconcileResult {
  deletedBothNullRem0: number;
  deletedLeftoverMemberPeriod: number;
  drainedLeftoverMemberPeriod: number;
  drainedLeftoverMemberPeriodCents: bigint;
  nulledDualOwnedNonPeriod: number;
  nulledDualOwnedOrgPeriod: number;
  scanned: number;
}

export interface CreditBucketOwnerXorParams {
  debug?: (message: string) => void;
  dryRun?: boolean;
  organizationId?: string;
}

interface CreditBucketOwnerXorClassifyRule {
  class: CreditBucketOwnerXorClass;
  matches: (row: CreditBucketOwnerClassifyInput) => boolean;
}

export class CreditBucketOwnerXorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreditBucketOwnerXorError";
  }
}

const XOR_MUTATE_CHUNK_SIZE = 1000;

function isBothOwned(row: CreditBucketOwnerClassifyInput): boolean {
  return row.userId != null && row.organizationId != null;
}

function isUnowned(row: CreditBucketOwnerClassifyInput): boolean {
  return row.userId == null && row.organizationId == null;
}

function isLeftoverMemberPeriod(row: CreditBucketOwnerClassifyInput): boolean {
  return (
    isBothOwned(row) &&
    row.referenceType ===
      CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD &&
    row.referenceId != null &&
    row.referenceId.startsWith(
      ORGANIZATION_MEMBER_SUBSCRIPTION_REFERENCE_PREFIX,
    )
  );
}

const CREDIT_BUCKET_OWNER_XOR_CLASSIFY_TABLE: readonly CreditBucketOwnerXorClassifyRule[] =
  [
    {
      class: CREDIT_BUCKET_OWNER_XOR_CLASSES.personal,
      matches: (row) => row.userId != null && row.organizationId == null,
    },
    {
      class: CREDIT_BUCKET_OWNER_XOR_CLASSES.org,
      matches: (row) => row.organizationId != null && row.userId == null,
    },
    {
      class: CREDIT_BUCKET_OWNER_XOR_CLASSES.leftover_member_period_rem_gt0,
      matches: (row) => isLeftoverMemberPeriod(row) && row.remaining > 0n,
    },
    {
      class: CREDIT_BUCKET_OWNER_XOR_CLASSES.leftover_member_period_rem0,
      matches: (row) => isLeftoverMemberPeriod(row),
    },
    {
      class: CREDIT_BUCKET_OWNER_XOR_CLASSES.dual_owned_org_period,
      matches: (row) =>
        isBothOwned(row) &&
        row.referenceType ===
          CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
    },
    {
      class: CREDIT_BUCKET_OWNER_XOR_CLASSES.dual_owned_non_period,
      matches: (row) => isBothOwned(row),
    },
    {
      class: CREDIT_BUCKET_OWNER_XOR_CLASSES.both_null_rem_gt0,
      matches: (row) => isUnowned(row) && row.remaining > 0n,
    },
    {
      class: CREDIT_BUCKET_OWNER_XOR_CLASSES.both_null_rem0,
      matches: (row) => isUnowned(row),
    },
  ];

export function classifyCreditBucketOwner(
  row: CreditBucketOwnerClassifyInput,
): CreditBucketOwnerXorClass {
  for (const rule of CREDIT_BUCKET_OWNER_XOR_CLASSIFY_TABLE) {
    if (rule.matches(row)) {
      return rule.class;
    }
  }

  throw new CreditBucketOwnerXorError("unclassified credit bucket owner row");
}

export function creditBucketOwnerClassAction(
  ownerClass: CreditBucketOwnerXorClass,
): CreditBucketOwnerClassAction {
  return CREDIT_BUCKET_OWNER_CLASS_ACTIONS[ownerClass];
}

function remainingOf(value: bigint | number | string): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

function mapOwnerXorRow(row: CreditBucketOwnerXorRow): CreditBucketOwnerXorRow {
  return {
    ...row,
    remaining: remainingOf(row.remaining),
  };
}

function emptyClassRecord<T>(value: T): Record<CreditBucketOwnerXorClass, T> {
  return {
    personal: value,
    org: value,
    leftover_member_period_rem0: value,
    leftover_member_period_rem_gt0: value,
    dual_owned_org_period: value,
    dual_owned_non_period: value,
    both_null_rem0: value,
    both_null_rem_gt0: value,
  };
}

async function listOwnerXorRows(
  prisma: PrismaClient | Prisma.TransactionClient,
  params: { organizationId?: string } = {},
): Promise<CreditBucketOwnerXorRow[]> {
  const ownerFilter = Prisma.sql`(
        (cb."userId" IS NOT NULL AND cb."organizationId" IS NOT NULL)
        OR (cb."userId" IS NULL AND cb."organizationId" IS NULL)
      )`;
  const organizationFilter = params.organizationId
    ? Prisma.sql`cb."organizationId" = ${params.organizationId}`
    : Prisma.sql`TRUE`;

  const rows = await prisma.$queryRaw<CreditBucketOwnerXorRow[]>`
    SELECT
      cb.id,
      cb."userId",
      cb."organizationId",
      cb."referenceId",
      cb."referenceType",
      (cb.amount - COALESCE(SUM(cc.amount), 0))::bigint AS remaining
    FROM credit_bucket cb
    LEFT JOIN credit_consumption cc ON cc."bucketId" = cb.id
    WHERE ${ownerFilter}
      AND ${organizationFilter}
    GROUP BY
      cb.id,
      cb."userId",
      cb."organizationId",
      cb."referenceId",
      cb."referenceType",
      cb.amount
  `;

  return rows.map(mapOwnerXorRow);
}

export async function listDualOwnedCreditBuckets(
  prisma: PrismaClient | Prisma.TransactionClient,
  organizationId?: string,
): Promise<CreditBucketOwnerXorRow[]> {
  const rows = await listOwnerXorRows(prisma, { organizationId });
  return rows.filter((row) => row.userId != null && row.organizationId != null);
}

export async function inventoryCreditBucketOwnerXor(
  prisma: PrismaClient | Prisma.TransactionClient,
  params: CreditBucketOwnerXorParams = {},
): Promise<CreditBucketOwnerXorInventory> {
  const rows = await listOwnerXorRows(prisma, {
    organizationId: params.organizationId,
  });
  const counts = emptyClassRecord(0);
  const remainingCentsByClass = emptyClassRecord(0n);
  const classified: Array<
    CreditBucketOwnerXorRow & { class: CreditBucketOwnerXorClass }
  > = [];

  for (const row of rows) {
    const ownerClass = classifyCreditBucketOwner(row);
    classified.push({ ...row, class: ownerClass });
    counts[ownerClass] += 1;
    remainingCentsByClass[ownerClass] += row.remaining;
    params.debug?.(
      `classify id=${row.id} class=${ownerClass} remaining=${row.remaining.toString()} userId=${row.userId} organizationId=${row.organizationId} referenceType=${row.referenceType} referenceId=${row.referenceId}`,
    );
  }

  return { counts, remainingCentsByClass, rows: classified };
}

function resultFromInventory(
  inventory: CreditBucketOwnerXorInventory,
): CreditBucketOwnerXorReconcileResult {
  return {
    deletedBothNullRem0: inventory.counts.both_null_rem0,
    deletedLeftoverMemberPeriod:
      inventory.counts.leftover_member_period_rem0 +
      inventory.counts.leftover_member_period_rem_gt0,
    drainedLeftoverMemberPeriod:
      inventory.counts.leftover_member_period_rem_gt0,
    drainedLeftoverMemberPeriodCents:
      inventory.remainingCentsByClass.leftover_member_period_rem_gt0,
    nulledDualOwnedNonPeriod: inventory.counts.dual_owned_non_period,
    nulledDualOwnedOrgPeriod: inventory.counts.dual_owned_org_period,
    scanned: inventory.rows.length,
  };
}

function idsOfClass(
  inventory: CreditBucketOwnerXorInventory,
  ownerClass: CreditBucketOwnerXorClass,
): string[] {
  return inventory.rows
    .filter((row) => row.class === ownerClass)
    .map((row) => row.id);
}

async function mutateIdChunks(
  ids: string[],
  mutate: (chunk: string[]) => Promise<unknown>,
): Promise<void> {
  for (let offset = 0; offset < ids.length; offset += XOR_MUTATE_CHUNK_SIZE) {
    await mutate(ids.slice(offset, offset + XOR_MUTATE_CHUNK_SIZE));
  }
}

function bothNullRemainingPositiveError(
  inventory: CreditBucketOwnerXorInventory,
): CreditBucketOwnerXorError {
  const remainingPositive = inventory.rows.filter(
    (row) => row.class === CREDIT_BUCKET_OWNER_XOR_CLASSES.both_null_rem_gt0,
  );
  const preview = remainingPositive
    .slice(0, 20)
    .map((row) => `${row.id} remaining=${row.remaining.toString()}`)
    .join(", ");
  return new CreditBucketOwnerXorError(
    `credit_bucket owner XOR: ${remainingPositive.length} both-null remaining>0 row(s); refuse to invent an owner: ${preview}`,
  );
}

async function drainLeftoverMemberPeriodRemaining(
  tx: Prisma.TransactionClient,
  leftover: CreditBucketOwnerXorRow,
): Promise<void> {
  if (!leftover.userId) {
    throw new CreditBucketOwnerXorError(
      `leftover member period ${leftover.id} missing userId; refuse to invent an owner`,
    );
  }

  await tx.transaction.create({
    data: {
      amount: leftover.remaining * -1n,
      organizationId: leftover.organizationId,
      userId: leftover.userId,
      creditConsumptions: {
        create: {
          amount: leftover.remaining,
          bucketId: leftover.id,
        },
      },
    },
  });
}

async function applyOwnerXorReconcile(
  tx: Prisma.TransactionClient,
  params: CreditBucketOwnerXorParams,
): Promise<CreditBucketOwnerXorReconcileResult> {
  const inventory = await inventoryCreditBucketOwnerXor(tx, params);
  if (inventory.counts.both_null_rem_gt0 > 0) {
    throw bothNullRemainingPositiveError(inventory);
  }

  const leftoverGt0 = inventory.rows.filter(
    (row) =>
      row.class ===
      CREDIT_BUCKET_OWNER_XOR_CLASSES.leftover_member_period_rem_gt0,
  );
  for (const leftover of leftoverGt0) {
    params.debug?.(
      `drain leftover id=${leftover.id} remaining=${leftover.remaining.toString()} userId=${leftover.userId}`,
    );
    await drainLeftoverMemberPeriodRemaining(tx, leftover);
  }

  const leftoverDeleteIds = [
    ...idsOfClass(
      inventory,
      CREDIT_BUCKET_OWNER_XOR_CLASSES.leftover_member_period_rem_gt0,
    ),
    ...idsOfClass(
      inventory,
      CREDIT_BUCKET_OWNER_XOR_CLASSES.leftover_member_period_rem0,
    ),
  ];
  await mutateIdChunks(leftoverDeleteIds, (chunk) =>
    tx.creditBucket.deleteMany({ where: { id: { in: chunk } } }),
  );

  await mutateIdChunks(
    idsOfClass(
      inventory,
      CREDIT_BUCKET_OWNER_XOR_CLASSES.dual_owned_non_period,
    ),
    (chunk) =>
      tx.creditBucket.updateMany({
        where: { id: { in: chunk } },
        data: { userId: null },
      }),
  );

  await mutateIdChunks(
    idsOfClass(
      inventory,
      CREDIT_BUCKET_OWNER_XOR_CLASSES.dual_owned_org_period,
    ),
    (chunk) =>
      tx.creditBucket.updateMany({
        where: { id: { in: chunk } },
        data: { userId: null },
      }),
  );

  await mutateIdChunks(
    idsOfClass(inventory, CREDIT_BUCKET_OWNER_XOR_CLASSES.both_null_rem0),
    (chunk) => tx.creditBucket.deleteMany({ where: { id: { in: chunk } } }),
  );

  const remaining = await listOwnerXorRows(tx, {
    organizationId: params.organizationId,
  });
  if (remaining.length > 0) {
    throw new CreditBucketOwnerXorError(
      `credit_bucket owner XOR: ${remaining.length} dual-owned or both-null row(s) remain after reconcile`,
    );
  }

  return resultFromInventory(inventory);
}

export async function reconcileCreditBucketOwnerXor(
  prisma: PrismaClient,
  params: CreditBucketOwnerXorParams = {},
): Promise<CreditBucketOwnerXorReconcileResult> {
  const inventory = await inventoryCreditBucketOwnerXor(prisma, params);
  if (inventory.counts.both_null_rem_gt0 > 0) {
    throw bothNullRemainingPositiveError(inventory);
  }

  if (params.dryRun) {
    return resultFromInventory(inventory);
  }

  return await prisma.$transaction((tx) => applyOwnerXorReconcile(tx, params), {
    timeout: 120_000,
  });
}
