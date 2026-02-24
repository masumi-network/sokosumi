import type { Lock } from "@sokosumi/database";

import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";

export const syncLockService = {
  async acquireLock(key: string): Promise<Lock> {
    return await prisma.$transaction(async (tx) => {
      await tx.lock.upsert({
        where: { key },
        create: { key },
        update: {},
      });

      const lockAcquiredAt = new Date();
      const lockExpirationThreshold = new Date(
        lockAcquiredAt.getTime() - getEnv().LOCK_TIMEOUT,
      );

      const acquireResult = await tx.lock.updateMany({
        where: {
          key,
          OR: [
            { isLocked: false },
            { isLocked: true, lockedAt: null },
            {
              isLocked: true,
              lockedAt: {
                lt: lockExpirationThreshold,
              },
            },
          ],
        },
        data: {
          isLocked: true,
          lockedBy: getEnv().INSTANCE_ID,
          lockedAt: lockAcquiredAt,
        },
      });

      if (acquireResult.count === 0) {
        throw new Error("LOCK_IS_LOCKED");
      }

      return await tx.lock.findUniqueOrThrow({
        where: {
          key,
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
