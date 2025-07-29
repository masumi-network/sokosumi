import "server-only";

import { getEnvSecrets } from "@/config/env.secrets";
import { Lock } from "@/prisma/generated/client";

import { BaseService } from "./base.service";

/**
 * LockService provides distributed locking mechanisms using the database.
 * It ensures that only one process can acquire a lock for a given key at a time,
 * with support for lock expiration and atomic acquisition/unlocking.
 */
export class LockService extends BaseService<LockService> {
  /**
   * Determines if a lock is expired based on its lockedAt timestamp.
   * @param lockedAt - The timestamp when the lock was acquired, or null if never locked.
   * @returns True if the lock is expired or never set, false otherwise.
   */
  private isLockExpired(lockedAt: Date | null): boolean {
    if (!lockedAt) return true;
    return Date.now() - lockedAt.getTime() > getEnvSecrets().LOCK_TIMEOUT;
  }

  /**
   * Creates a new lock entry in the database for the given key and instance.
   * @param key - The unique identifier for the lock.
   * @param instanceId - The ID of the instance acquiring the lock.
   * @returns The created Lock object.
   */
  private async createLockByKey(
    key: string,
    instanceId: string,
  ): Promise<Lock> {
    return await this.client.lock.create({
      data: {
        key,
        lockedBy: instanceId,
        lockedAt: new Date(),
        isLocked: true,
      },
    });
  }

  /**
   * Atomically unlocks the lock for the given key if it is currently locked.
   * @param key - The unique identifier for the lock.
   * @returns True if the lock was successfully unlocked, false otherwise.
   */
  async unlockLock(key: string): Promise<boolean> {
    // Atomically unlock only if currently locked
    const result = await this.client.lock.updateMany({
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
      // Successfully unlocked
      return true;
    }
    // Failed to unlock (was not locked)
    return false;
  }

  /**
   * Attempts to acquire a lock for the given key and instance.
   * If the lock does not exist, it is created.
   * If the lock exists and is expired, it is force-unlocked and re-acquired.
   * If the lock exists and is not expired, an error is thrown.
   * @param key - The unique identifier for the lock.
   * @param instanceId - The ID of the instance attempting to acquire the lock.
   * @throws Error "LOCK_IS_LOCKED" if the lock is currently held and not expired.
   * @throws Error "LOCK_NOT_ACQUIRED" if the lock could not be acquired due to a race condition.
   * @returns The acquired Lock object.
   */
  async acquireLock(key: string, instanceId: string): Promise<Lock> {
    // Check if lock exists and is expired
    const existingLock = await this.client.lock.findFirst({ where: { key } });
    if (!existingLock) {
      return await this.createLockByKey(key, instanceId);
    }
    // If lock exists and is not expired, return the lock
    if (existingLock.isLocked && !this.isLockExpired(existingLock.lockedAt)) {
      throw new Error("LOCK_IS_LOCKED");
    }

    // If lock exists and is expired, force unlock
    if (existingLock.isLocked && this.isLockExpired(existingLock.lockedAt)) {
      await this.client.lock.update({
        where: { key },
        data: { isLocked: false, lockedBy: null, lockedAt: null },
      });
    }
    // Try to atomically acquire the lock if it is not locked
    const result = await this.client.lock.updateMany({
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
      lock = await this.client.lock.findFirst({ where: { key } });
    }
    // Failed to acquire the lock
    if (!lock) {
      throw new Error("LOCK_NOT_ACQUIRED");
    }
    return lock;
  }
}
