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
export const FREE_CREDIT_REFERENCE_SEGMENT = "free";

export function getCreditExpiryDate(baseDate: Date, days: number): Date {
  if (!Number.isFinite(days) || !Number.isInteger(days) || days < 0) {
    throw new Error("Expiry days must be a non-negative integer");
  }

  return new Date(baseDate.getTime() + days * MILLISECONDS_PER_DAY);
}

export function getOrganizationMemberSubscriptionReferencePrefix(
  userId: string,
): string {
  return `${ORGANIZATION_MEMBER_SUBSCRIPTION_REFERENCE_PREFIX}${userId}:`;
}

export function buildOrganizationMemberSubscriptionReferenceId(
  userId: string,
  referenceSuffix: string,
): string {
  validateReferenceSegment(userId, "userId");
  validateReferenceSegment(referenceSuffix, "referenceSuffix");

  return `${getOrganizationMemberSubscriptionReferencePrefix(userId)}${referenceSuffix}`;
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

export function buildFreeCreditReferenceId(params: {
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

  return `${targetPrefix}${params.targetId}:${FREE_CREDIT_REFERENCE_SEGMENT}:${params.grantId}`;
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
