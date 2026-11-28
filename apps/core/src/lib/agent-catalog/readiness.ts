import type { NetworkScope, SharedDb } from "@/lib/db/network-scope";
import { type Network, networkKey } from "@/lib/network";
export interface ReadinessScope extends NetworkScope {
  writeShared?<T>(write: (db: SharedDb) => Promise<T>): Promise<T>;
}

function writeReadiness<T>(
  scope: ReadinessScope,
  write: (db: SharedDb) => Promise<T>,
): Promise<T> {
  return scope.writeShared ? scope.writeShared(write) : write(scope.sharedDb);
}

/**
 * x402 buy-side readiness (PR1-SPEC §6, ticket 011 Q5).
 *
 * Composed Soko-side from the node's `GET /x402/networks/available`,
 * `GET /x402/wallets`, and the calling key's spend caps on
 * `GET /api-key-status`, by
 * `syncX402BuySideReadiness`, cached in SyncMetadata under
 * the `x402-buy-side-readiness` key exactly like the Cardano V2 rail readiness:
 * last-known-value semantics, failure marker for one page per streak, and a
 * never-recorded state that hides the entire x402 listing (fail closed).
 */
const readinessKeys = {
  cardanoV2: "cardano-v2-rail-readiness",
  x402: "x402-buy-side-readiness",
} as const;
type Rail = keyof typeof readinessKeys;

/**
 * Marker states. The row exists for the length of one failure streak and a
 * successful check deletes it, so these are the streak's own states, not the
 * rail's. "failed" is what a fresh streak writes; the escalation flips it so
 * exactly one worker can report the streak outliving the threshold below.
 */
const READINESS_FAILURE_NEW = "failed";
const READINESS_FAILURE_ESCALATED = "escalated";

export function readinessKey(network: Network, rail: Rail) {
  return networkKey(network, readinessKeys[rail]);
}

export function readinessFailureKey(network: Network, rail: Rail) {
  return networkKey(network, `${readinessKeys[rail]}-failure`);
}

export function readReadiness(db: SharedDb, network: Network, rail: Rail) {
  return db.syncMetadata.findUnique({
    where: { key: readinessKey(network, rail) },
  });
}

export async function saveReadiness(
  scope: ReadinessScope,
  rail: Rail,
  cursorId: string,
) {
  const previous = await readReadiness(scope.sharedDb, scope.network, rail);
  const key = readinessKey(scope.network, rail);
  await writeReadiness(scope, (db) =>
    db.syncMetadata.upsert({
      where: { key },
      create: { key, cursorId, lastSyncedAt: new Date() },
      update: { cursorId, lastSyncedAt: new Date() },
    }),
  );
  return previous?.cursorId !== cursorId;
}

export function findRecordedReadiness(scope: NetworkScope, rail: Rail) {
  return scope.sharedDb.syncMetadata.findUnique({
    where: { key: readinessKey(scope.network, rail) },
    select: { key: true },
  });
}

export function markReadinessFailure(scope: ReadinessScope, rail: Rail) {
  return writeReadiness(scope, (db) =>
    db.syncMetadata.createMany({
      data: [
        {
          key: readinessFailureKey(scope.network, rail),
          cursorId: READINESS_FAILURE_NEW,
          lastSyncedAt: new Date(),
        },
      ],
      skipDuplicates: true,
    }),
  );
}

export function escalateCardanoReadinessFailure(
  scope: ReadinessScope,
  startedBefore: Date,
) {
  return writeReadiness(scope, (db) =>
    db.syncMetadata.updateMany({
      where: {
        key: readinessFailureKey(scope.network, "cardanoV2"),
        cursorId: READINESS_FAILURE_NEW,
        lastSyncedAt: { lt: startedBefore },
      },
      data: { cursorId: READINESS_FAILURE_ESCALATED },
    }),
  );
}

export function clearReadinessFailure(scope: ReadinessScope, rail: Rail) {
  return writeReadiness(scope, (db) =>
    db.syncMetadata.deleteMany({
      where: { key: readinessFailureKey(scope.network, rail) },
    }),
  );
}
