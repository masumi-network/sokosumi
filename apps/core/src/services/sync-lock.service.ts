import { randomUUID } from "node:crypto";

import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";

export interface AcquiredSyncLock {
  key: string;
  ownerToken: string;
}

export const syncLockService = {
  async acquireLock(key: string): Promise<AcquiredSyncLock> {
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
      const ownerToken = `${getEnv().INSTANCE_ID}:${randomUUID()}`;

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
          lockedBy: ownerToken,
          lockedAt: lockAcquiredAt,
        },
      });

      if (acquireResult.count === 0) {
        throw new Error("LOCK_IS_LOCKED");
      }

      return {
        key,
        ownerToken,
      };
    });
  },

  async releaseLock(key: string, ownerToken: string): Promise<boolean> {
    const releaseResult = await prisma.lock.updateMany({
      where: {
        key,
        isLocked: true,
        lockedBy: ownerToken,
      },
      data: {
        isLocked: false,
        lockedBy: null,
        lockedAt: null,
      },
    });

    return releaseResult.count > 0;
  },
};
