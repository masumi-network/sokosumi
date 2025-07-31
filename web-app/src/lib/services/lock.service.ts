import { getEnvSecrets } from "@/config/env.secrets";
import { lockRepository } from "@/lib/db/repositories";
import { Lock } from "@/prisma/generated/client";

export const lockService = {
  async acquireLock(key: string, instanceId: string): Promise<Lock> {
    // Check if lock exists and is expired
    let lock = await lockRepository.getLockByKey(key);
    lock ??= await lockRepository.createLockByKey(key);

    // If lock exists and is not expired, return the lock
    if (lock.isLocked && !isLockExpired(lock.lockedAt)) {
      throw new Error("LOCK_IS_LOCKED");
    }

    // If lock exists and is expired, force unlock
    if (lock.isLocked && isLockExpired(lock.lockedAt)) {
      lock = await lockRepository.unlockByKey(key);
    }

    // Try to atomically acquire the lock if it is not locked
    return await lockRepository.lockByKey(key, instanceId);
  },
};

function isLockExpired(lockedAt: Date | null): boolean {
  if (!lockedAt) return true;
  return Date.now() - lockedAt.getTime() > getEnvSecrets().LOCK_TIMEOUT;
}
