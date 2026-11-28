import { creditBucketActivatesAtOrBefore } from "@sokosumi/database/helpers";
import { creditBucketRepository } from "@sokosumi/database/repositories";
import { convertCentsToCredits } from "@sokosumi/utils";
import type { NetworkScope, SharedDb } from "@/lib/db/network-scope";

export function getBalance(
  scope: NetworkScope,
  userId: string | null,
  organizationId: string | null,
  tx: SharedDb,
  options?: { projectId?: string | null },
): Promise<bigint> {
  return creditBucketRepository.getNetworkBalance(
    scope.network,
    userId,
    organizationId,
    tx,
    options,
  );
}

export function getOrganizationPoolBalance(
  scope: NetworkScope,
  organizationId: string,
  tx: SharedDb,
  options?: { projectId?: string | null },
) {
  return creditBucketRepository.getOrganizationPoolBalance(
    scope.network,
    organizationId,
    tx,
    options,
  );
}

export function sumOrganizationEnterprisePoolBalances(
  scope: NetworkScope,
  organizationId: string,
  tx: SharedDb,
  now: Date,
) {
  return creditBucketRepository.sumOrganizationEnterprisePoolBalances(
    scope.network,
    organizationId,
    tx,
    now,
  );
}

export function sumOrganizationOwnedCreditBalances(
  scope: NetworkScope,
  organizationId: string,
  tx: SharedDb,
) {
  return creditBucketRepository.sumOrganizationOwnedCreditBalances(
    scope.network,
    organizationId,
    tx,
  );
}

export async function getCredits(
  scope: NetworkScope,
  userId: string | null,
  organizationId: string | null,
  tx: SharedDb = scope.sharedDb,
  options?: { projectId?: string | null },
): Promise<number> {
  const cents = await getBalance(scope, userId, organizationId, tx, options);
  return convertCentsToCredits(cents);
}

export async function lowBalanceFunding(
  scope: NetworkScope,
  wallet: {
    userId: string | null;
    organizationId: string | null;
  },
) {
  const newestBucket = await scope.networkDb.creditBucket.findFirst({
    where: {
      ...(wallet.organizationId
        ? { organizationId: wallet.organizationId }
        : { userId: wallet.userId, organizationId: null }),
      ...creditBucketActivatesAtOrBefore(new Date()),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  const balance = await getBalance(
    scope,
    wallet.userId,
    wallet.organizationId,
    scope.sharedDb,
  );
  return { balance, newestBucket };
}

export function cusoFunding(scope: NetworkScope, projectId: string, now: Date) {
  // Expired buckets too: the newest funding keys the crossing, and an
  // expiry is not new funding. Only unexpired ones count to the balance.
  return scope.networkDb.creditBucket.findMany({
    where: {
      AND: [{ projectId }, creditBucketActivatesAtOrBefore(now)],
    },
    select: {
      id: true,
      createdAt: true,
      expiresAt: true,
      amount: true,
      consumptions: { select: { amount: true } },
    },
  });
}
