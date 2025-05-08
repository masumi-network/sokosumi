import { getEnvSecrets } from "@/config/env.config";
import {
  createLockByKey,
  getLockByKey,
  prisma,
  tryAcquireLockByKey,
  tryUnlockLockByKey,
} from "@/lib/db";
import { Lock, Prisma } from "@/prisma/generated/client";

export async function getOrCreateLock(
  key: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Lock> {
  const lock =
    (await getLockByKey(key, tx)) ??
    (await createLockByKey(key, getEnvSecrets().INSTANCE_ID, tx));
  return lock;
}

export async function acquireLock(
  lockKey: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Lock> {
  const lock = await tryAcquireLockByKey(
    lockKey,
    getEnvSecrets().INSTANCE_ID,
    tx,
  );
  if (!lock) {
    throw new Error(
      `Failed to acquire lock for key: ${lockKey}. Lock may have been modified concurrently.`,
    );
  }
  return lock;
}

export async function releaseLock(
  key: string,
  tx: Prisma.TransactionClient = prisma,
) {
  const updatedLock = await tryUnlockLockByKey(key, tx);
  if (!updatedLock) {
    console.error(
      "Lock changed while locked, will not release. Expected key",
      key,
    );
  }
}
