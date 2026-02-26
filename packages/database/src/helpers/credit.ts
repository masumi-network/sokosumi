import { Decimal } from "decimal.js";

const CREDITS_BASE = 10 ** 10;
export const ORGANIZATION_MEMBER_SUBSCRIPTION_REFERENCE_PREFIX = "member:";

interface SplitAmountEvenlyWithRemainderRotationParams {
  memberIds: string[];
  remainderOffset?: number;
  totalAmount: bigint;
}

interface SplitAmountEvenlyWithRemainderRotationResult {
  allocations: Array<{ amount: bigint; memberId: string }>;
  nextRemainderOffset: number;
}

/**
 * Converts credit cents (stored as BigInt) to user-facing credit value.
 * @param cents - Credit amount in cents (1 credit = 10^10 cents)
 * @returns Credit value as decimal number
 */
export function convertCentsToCredits(cents: bigint): number {
  let credits = 0;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    credits = new Decimal(cents.toString()).div(CREDITS_BASE).toNumber();
  } else {
    credits = Number(cents) / CREDITS_BASE;
  }
  return credits;
}

/**
 * Converts user-facing credit value to credit cents (stored as BigInt).
 * @param credits - Credit value as decimal number
 * @returns Credit amount in cents (1 credit = 10^10 cents)
 */
export function convertCreditsToCents(credits: number): bigint {
  return BigInt(new Decimal(credits).mul(CREDITS_BASE).toFixed(0).toString());
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
  if (!referenceSuffix) {
    throw new Error("referenceSuffix is required");
  }

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
