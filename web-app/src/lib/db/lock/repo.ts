"use server";

import { prisma } from "@/lib/db";
import { Lock, Prisma } from "@/prisma/generated/client";

export async function getFirstLockByLockKey(
  lockKey: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Lock | null> {
  return await tx.lock.findFirst({ where: { key: lockKey } });
}

export async function createLock(
  lockKey: string,
  instanceId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Lock> {
  return await tx.lock.create({
    data: {
      key: lockKey,
      lockedBy: instanceId,
      lockedAt: new Date(),
      isLocked: true,
    },
  });
}

export async function updateLockToLocked(
  lockId: string,
  instanceId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Lock> {
  return await tx.lock.update({
    where: { id: lockId },
    data: {
      lockedBy: instanceId,
      lockedAt: new Date(),
      isLocked: true,
    },
  });
}

export async function updateLockByKeyToUnLocked(
  key: string,
  updatedAt: Date,
  tx: Prisma.TransactionClient = prisma,
) {
  return await tx.lock.update({
    where: { key, updatedAt },
    data: { isLocked: false, lockedBy: null, lockedAt: null },
  });
}
