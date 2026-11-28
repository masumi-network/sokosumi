import { creditBucketActivatesAtOrBefore } from "@sokosumi/database/helpers";
import { creditBucketRepository } from "@sokosumi/database/repositories";
import { convertCentsToCredits } from "@sokosumi/utils";
import type { NetworkScope, SharedDb } from "@/lib/db/network-scope";
import { chargesCredits, requireChargingNetwork } from "./policy";

/** A Network that charges no credits has no balance: asking for one is a mistake. */
function chargingNetwork(scope: NetworkScope) {
  const { network } = scope;
  requireChargingNetwork(network, "A credit balance");
  return network;
}

export function getBalance(
  scope: NetworkScope,
  userId: string | null,
  organizationId: string | null,
  tx: SharedDb,
  options?: { projectId?: string | null },
): Promise<bigint> {
  return creditBucketRepository.getNetworkBalance(
    chargingNetwork(scope),
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
    chargingNetwork(scope),
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
    chargingNetwork(scope),
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
    chargingNetwork(scope),
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

/**
 * The newest funding and the balance of a wallet just charged, for its
 * low-balance warning. Null on a Network that charges no credits: nothing
 * was taken, so nothing warns (the user, 2026-11-27).
 */
export async function lowBalanceFunding(
  scope: NetworkScope,
  wallet: {
    userId: string | null;
    organizationId: string | null;
  },
) {
  if (!chargesCredits(scope.network)) return null;
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
  chargingNetwork(scope);
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
