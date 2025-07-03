import "server-only";

import { getEnvSecrets } from "@/config/env.secrets";
import { Lock, Prisma } from "@/prisma/generated/client";

import prisma from "./prisma";

function isLockExpired(lockedAt: Date | null): boolean {
  if (!lockedAt) return true;
  return Date.now() - lockedAt.getTime() > getEnvSecrets().LOCK_TIMEOUT;
}

async function createLockByKey(
  key: string,
  instanceId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Lock> {
  return await tx.lock.create({
    data: {
      key,
      lockedBy: instanceId,
      lockedAt: new Date(),
      isLocked: true,
    },
  });
}

export async function unlockLock(
  key: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Lock | null> {
  // Atomically unlock only if currently locked
  const result = await tx.lock.updateMany({
    where: {
      key,
      isLocked: true,
    },
    data: {
      isLocked: false,
      lockedBy: null,
      lockedAt: null,
    },
  });
  if (result.count === 1) {
    // Successfully unlocked, return the updated lock
    return await tx.lock.findFirst({ where: { key } });
  }
  // Failed to unlock (was not locked)
  return null;
}

export async function acquireLock(
  key: string,
  instanceId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Lock> {
  // Check if lock exists and is expired
  const existingLock = await tx.lock.findFirst({ where: { key } });
  if (!existingLock) {
    return await createLockByKey(key, instanceId, tx);
  }
  // If lock exists and is not expired, return the lock
  if (existingLock.isLocked && !isLockExpired(existingLock.lockedAt)) {
    throw new Error("LOCK_IS_LOCKED");
  }

  // If lock exists and is expired, force unlock
  if (existingLock.isLocked && isLockExpired(existingLock.lockedAt)) {
    await tx.lock.update({
      where: { key },
      data: { isLocked: false, lockedBy: null, lockedAt: null },
    });
  }
  // Try to atomically acquire the lock if it is not locked
  const result = await tx.lock.updateMany({
    where: {
      key,
      isLocked: false,
    },
    data: {
      isLocked: true,
      lockedBy: instanceId,
      lockedAt: new Date(),
    },
  });
  let lock: Lock | null = null;
  if (result.count === 1) {
    // Successfully acquired the lock, return the updated lock
    lock = await tx.lock.findFirst({ where: { key } });
  }
  // Failed to acquire the lock
  if (!lock) {
    throw new Error("LOCK_NOT_ACQUIRED");
  }
  return lock;
}
