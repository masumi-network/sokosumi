import { Lock } from "@sokosumi/database";
import prisma from "@sokosumi/database/client";
import { lockRepository } from "@sokosumi/database/repositories";

import { getEnvSecrets } from "@/config/env.secrets";

/**
 * Service for distributed lock management using the Lock model.
 * Ensures that only one process can acquire a lock for a given key at a time.
 */
export const lockService = (() => {
  function isLockExpired(lockedAt: Date | null): boolean {
    if (!lockedAt) return true;
    return Date.now() - lockedAt.getTime() > getEnvSecrets().LOCK_TIMEOUT;
  }

  return {
    /**
     * Attempts to acquire a lock for the specified key and instance.
     * - If the lock does not exist, it is created.
     * - If the lock exists and is not expired, throws an error.
     * - If the lock exists and is expired, it is forcefully unlocked before acquiring.
     * - Lock acquisition is atomic to prevent race conditions.
     *
     * @param key - The unique key identifying the lock.
     * @param instanceId - The identifier of the instance attempting to acquire the lock.
     * @returns The acquired Lock object.
     * @throws Error with message "LOCK_IS_LOCKED" if the lock is currently held and not expired.
     */
    async acquireLock(key: string, instanceId: string): Promise<Lock> {
      // Retrieve existing lock or create a new one if it doesn't exist
      return await prisma.$transaction(async (tx) => {
        let lock = await lockRepository.getLockByKey(key, tx);

        // Handle the race condition where two processes try to create the lock at the same time
        if (!lock) {
          try {
            lock = await lockRepository.createLockByKey(key, tx);
          } catch {
            // Another process created it, retry getting it
            lock = await lockRepository.getLockByKey(key, tx);
            if (!lock) throw new Error("LOCK_CREATION_FAILED");
          }
        }

        // If the lock is currently held and not expired, prevent acquisition
        if (lock.isLocked && !isLockExpired(lock.lockedAt)) {
          throw new Error("LOCK_IS_LOCKED");
        }

        // If the lock is held but expired, forcefully unlock it
        if (lock.isLocked && isLockExpired(lock.lockedAt)) {
          lock = await lockRepository.unlockByKey(key, tx);
        }

        // Atomically acquire the lock for this instance
        return await lockRepository.lockByKey(key, instanceId, tx);
      });
    },
  };
})();
