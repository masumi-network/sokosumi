import type { Prisma } from "@sokosumi/database";
import { creditBucketRepository } from "@sokosumi/database/repositories";
import { convertCentsToCredits } from "@sokosumi/utils";

import prisma from "@/lib/db/prisma";

/**
 * Gets credit balance in cents for a user or organization
 *
 * @param userId - Seat / poolAccess actor. Still used when organizationId is set.
 * @param organizationId - Optional organization ID. If provided, returns organization credits; otherwise returns user credits
 * @param tx - Optional Prisma transaction client for transaction support
 * @returns The credit in cents as a bigint
 */
export async function getCents(
  userId: string,
  organizationId: string | null,
  tx: Prisma.TransactionClient = prisma,
): Promise<bigint> {
  return await creditBucketRepository.getBalance(userId, organizationId, tx);
}

/**
 * Gets credits for a user or organization
 *
 * @param userId - Seat / poolAccess actor. Still used when organizationId is set.
 * @param organizationId - Optional organization ID. If provided, returns organization credits; otherwise returns user credits
 * @param tx - Optional Prisma transaction client for transaction support
 * @returns The credits as a number
 */
export async function getCredits(
  userId: string,
  organizationId: string | null,
  tx: Prisma.TransactionClient = prisma,
): Promise<number> {
  const cents = await getCents(userId, organizationId, tx);
  return convertCentsToCredits(cents);
}
