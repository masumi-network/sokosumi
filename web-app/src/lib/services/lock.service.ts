import { getEnvSecrets } from "@/config/env.config";
import {
  createLock,
  getFirstLockByLockKey,
  prisma,
  updateLockByKeyToUnLocked,
  updateLockToLocked,
} from "@/lib/db";

export async function getLock(lockKey: string) {
  return await prisma.$transaction(async (tx) => {
    // Example: Try to acquire a lock on a specific agent
    // Using pessimistic locking with 'FOR UPDATE'
    const lock = await getFirstLockByLockKey(lockKey, tx);
    const instanceId = getEnvSecrets().INSTANCE_ID;

    if (!lock) {
      return await createLock(lockKey, instanceId, tx);
    }

    if (lock.isLocked) {
      if (
        lock.lockedAt &&
        lock.lockedAt < new Date(Date.now() - getEnvSecrets().LOCK_TIMEOUT)
      ) {
        //TODO: better logging
        console.warn(
          "Lock timeout reached, will release key",
          lockKey,
          "last updated at: ",
          lock.updatedAt,
          " by instance: ",
          lock.lockedBy,
        );
        return await updateLockToLocked(lock.id, instanceId, tx);
      }
      return null;
    }
    return await updateLockToLocked(lock.id, instanceId, tx);
  });
}

export async function releaseLock(lock: { key: string; updatedAt: Date }) {
  const updatedLock = await updateLockByKeyToUnLocked(lock.key, lock.updatedAt);
  if (!updatedLock) {
    console.error(
      "Lock changed while locked, will not release. Expected key",
      lock.key,
      "to be last updated at: ",
      lock.updatedAt,
    );
  }
}
