import type { Lock } from "@sokosumi/database";
import { lockRepository } from "@sokosumi/database/repositories";

import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";

function isLockExpired(lockedAt: Date | null): boolean {
  if (!lockedAt) {
    return true;
  }

  return Date.now() - lockedAt.getTime() > getEnv().LOCK_TIMEOUT;
}

export const syncLockService = {
  async acquireLock(key: string): Promise<Lock> {
    return await prisma.$transaction(async (tx) => {
      let lock = await lockRepository.getLockByKey(key, tx);

      if (!lock) {
        try {
          lock = await lockRepository.createLockByKey(key, tx);
        } catch {
          lock = await lockRepository.getLockByKey(key, tx);
          if (!lock) {
            throw new Error("LOCK_CREATION_FAILED");
          }
        }
      }

      if (lock.isLocked && !isLockExpired(lock.lockedAt)) {
        throw new Error("LOCK_IS_LOCKED");
      }

      if (lock.isLocked && isLockExpired(lock.lockedAt)) {
        lock = await lockRepository.unlockByKey(key, tx);
      }

      return await lockRepository.lockByKey(key, getEnv().INSTANCE_ID, tx);
    });
  },

  async releaseLock(key: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await lockRepository.unlockByKey(key, tx);
    });
  },
};
