"use server";

import { getEnvSecrets } from "@/config/env.config";
import { prisma } from "@/lib/db";
import { Lock, Prisma } from "@/prisma/generated/client";

const LOCK_TIMEOUT_MS = getEnvSecrets().LOCK_TIMEOUT;

function isLockExpired(lockedAt: Date | null): boolean {
  if (!lockedAt) return true;
  return Date.now() - lockedAt.getTime() > LOCK_TIMEOUT_MS;
}

export async function getLockByKey(
  key: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Lock | null> {
  const lock = await tx.lock.findFirst({ where: { key } });
  if (!lock) return null;
  if (isLockExpired(lock.lockedAt)) {
    // If expired, allow force-unlock
    return await tx.lock.update({
      where: { key },
      data: { isLocked: false, lockedBy: null, lockedAt: null },
    });
  }
  return lock;
}

export async function createLockByKey(
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

export async function tryUnlockLockByKey(
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

export async function tryAcquireLockByKey(
  key: string,
  instanceId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Lock | null> {
  // Check if lock exists and is expired
  const existingLock = await tx.lock.findFirst({ where: { key } });
  if (existingLock) {
    if (existingLock.isLocked && !isLockExpired(existingLock.lockedAt)) {
      // Lock is held and not expired
      return existingLock;
    }
    if (existingLock.isLocked && isLockExpired(existingLock.lockedAt)) {
      // Force unlock expired lock
      await tx.lock.update({
        where: { key },
        data: { isLocked: false, lockedBy: null, lockedAt: null },
      });
    }
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

  if (result.count === 1) {
    // Successfully acquired the lock, return the updated lock
    return await tx.lock.findFirst({ where: { key } });
  }
  // Failed to acquire the lock
  return null;
}
