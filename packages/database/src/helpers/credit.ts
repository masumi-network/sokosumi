import { Prisma } from "../generated/prisma/client.js";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Prisma filter: bucket is spendable at `now` (null activatesAt = immediate).
 */
export function creditBucketActivatesAtOrBefore(
  now: Date,
): Prisma.CreditBucketWhereInput {
  return {
    OR: [{ activatesAt: null }, { activatesAt: { lte: now } }],
  };
}

/**
 * Raw SQL fragment for spendable buckets at `now`.
 */
export function creditBucketActivatesAtOrBeforeSql(now: Date): Prisma.Sql {
  return Prisma.sql`(cb."activatesAt" IS NULL OR cb."activatesAt" <= ${now})`;
}

export const ORGANIZATION_MEMBER_SUBSCRIPTION_REFERENCE_PREFIX = "member:";
export const USER_CREDIT_REFERENCE_PREFIX = "user:";
export const ORGANIZATION_CREDIT_REFERENCE_PREFIX = "org:";
export const SUPPORT_CREDIT_REFERENCE_PREFIX = "support:";

interface SplitAmountEvenlyWithRemainderRotationParams {
  memberIds: string[];
  remainderOffset?: number;
  totalAmount: bigint;
}

interface SplitAmountEvenlyWithRemainderRotationResult {
  allocations: Array<{ amount: bigint; memberId: string }>;
  nextRemainderOffset: number;
}

export function getCreditExpiryDate(baseDate: Date, days: number): Date {
  if (!Number.isFinite(days) || !Number.isInteger(days) || days < 0) {
    throw new Error("Expiry days must be a non-negative integer");
  }

  return new Date(baseDate.getTime() + days * MILLISECONDS_PER_DAY);
}

/**
 * Escapes a string for use as a literal in SQL LIKE patterns (e.g. when using Prisma's startsWith).
 * Prisma translates startsWith to LIKE 'value%'; the database treats % and _ as wildcards, so they must be escaped.
 */
export function escapeStringForLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export function getOrganizationMemberSubscriptionReferencePrefix(
  userId: string,
): string {
  return `${ORGANIZATION_MEMBER_SUBSCRIPTION_REFERENCE_PREFIX}${userId}:`;
}

/**
 * Returns the organization member subscription reference prefix with LIKE wildcards escaped.
 * Use when filtering by referenceId with Prisma's startsWith (where clauses).
 * For building or comparing full reference IDs, use getOrganizationMemberSubscriptionReferencePrefix instead.
 */
export function getOrganizationMemberSubscriptionReferencePrefixForStartsWith(
  userId: string,
): string {
  return escapeStringForLike(
    getOrganizationMemberSubscriptionReferencePrefix(userId),
  );
}

export function buildOrganizationMemberSubscriptionReferenceId(
  userId: string,
  referenceSuffix: string,
): string {
  validateReferenceSegment(userId, "userId");
  validateReferenceSegment(referenceSuffix, "referenceSuffix");

  return `${getOrganizationMemberSubscriptionReferencePrefix(userId)}${referenceSuffix}`;
}

export function splitAmountEvenlyWithRemainderRotation(
  params: SplitAmountEvenlyWithRemainderRotationParams,
): SplitAmountEvenlyWithRemainderRotationResult {
  if (params.memberIds.length === 0 || params.totalAmount <= 0n) {
    return {
      allocations: [],
      nextRemainderOffset: 0,
    };
  }

  const memberCount = params.memberIds.length;
  const memberCountBigInt = BigInt(memberCount);
  const rawRemainderOffset = params.remainderOffset ?? 0;
  const requestedOffset = Number.isFinite(rawRemainderOffset)
    ? Math.trunc(rawRemainderOffset)
    : 0;
  const normalizedOffset =
    ((requestedOffset % memberCount) + memberCount) % memberCount;
  const baseAmount = params.totalAmount / memberCountBigInt;
  const remainder = Number(params.totalAmount % memberCountBigInt);

  const allocationAmounts = Array<bigint>(memberCount).fill(baseAmount);
  for (let index = 0; index < remainder; index += 1) {
    const targetIndex = (normalizedOffset + index) % memberCount;
    allocationAmounts[targetIndex] += 1n;
  }

  const allocations = params.memberIds
    .map((memberId, index) => ({
      memberId,
      amount: allocationAmounts[index] ?? 0n,
    }))
    .filter((allocation) => allocation.amount > 0n);

  return {
    allocations,
    nextRemainderOffset: (normalizedOffset + remainder) % memberCount,
  };
}

function validateReferenceSegment(segment: string, name: string): void {
  if (!segment) {
    throw new Error(`${name} is required`);
  }
}

export function buildSignupBonusCreditReferenceId(userId: string): string {
  validateReferenceSegment(userId, "userId");

  return `${USER_CREDIT_REFERENCE_PREFIX}${userId}`;
}

export function buildSupportCreditReferenceId(params: {
  grantId: string;
  targetId: string;
  targetType: "user" | "organization";
}): string {
  validateReferenceSegment(params.grantId, "grantId");
  validateReferenceSegment(params.targetId, "targetId");

  const targetPrefix =
    params.targetType === "user"
      ? USER_CREDIT_REFERENCE_PREFIX
      : ORGANIZATION_CREDIT_REFERENCE_PREFIX;

  return `${SUPPORT_CREDIT_REFERENCE_PREFIX}${targetPrefix}${params.targetId}:${params.grantId}`;
}

export function buildUserInvoiceCreditReferenceId(
  userId: string,
  invoiceId: string,
  grantType: "subscription" | "topup",
): string {
  validateReferenceSegment(userId, "userId");
  validateReferenceSegment(invoiceId, "invoiceId");

  return `${USER_CREDIT_REFERENCE_PREFIX}${userId}:${invoiceId}:${grantType}`;
}

export function buildOrganizationInvoiceCreditReferenceId(
  organizationId: string,
  invoiceId: string,
  grantType: "subscription" | "topup",
): string {
  validateReferenceSegment(organizationId, "organizationId");
  validateReferenceSegment(invoiceId, "invoiceId");

  return `${ORGANIZATION_CREDIT_REFERENCE_PREFIX}${organizationId}:${invoiceId}:${grantType}`;
}
