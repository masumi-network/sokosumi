import type { Lock } from "@sokosumi/database";

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
      const lock = await tx.lock.upsert({
        where: { key },
        create: { key },
        update: {},
      });

      if (lock.isLocked && !isLockExpired(lock.lockedAt)) {
        throw new Error("LOCK_IS_LOCKED");
      }

      if (lock.isLocked && isLockExpired(lock.lockedAt)) {
        await tx.lock.update({
          where: { key },
          data: {
            isLocked: false,
            lockedBy: null,
            lockedAt: null,
          },
        });
      }

      return await tx.lock.update({
        where: { key },
        data: {
          isLocked: true,
          lockedBy: getEnv().INSTANCE_ID,
          lockedAt: new Date(),
        },
      });
    });
  },

  async releaseLock(key: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.lock.update({
        where: { key },
        data: {
          isLocked: false,
          lockedBy: null,
          lockedAt: null,
        },
      });
    });
  },
};
