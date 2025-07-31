import "server-only";

import { Lock, Prisma } from "@/prisma/generated/client";

import prisma from "./prisma";

/**
 * Repository for distributed lock management using the Lock model.
 * Provides methods to create, retrieve, acquire, and release locks in a transactional and atomic manner.
 */
export const lockRepository = {
  /**
   * Creates a new lock entry for the specified key.
   * If a lock with the given key already exists, this will throw a unique constraint error.
   *
   * @param key - The unique key identifying the lock.
   * @param tx - (Optional) The Prisma transaction client to use. Defaults to the main Prisma client.
   * @returns The created Lock object.
   */
  async createLockByKey(
    key: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Lock> {
    return await tx.lock.create({
      data: {
        key,
      },
    });
  },

  /**
   * Retrieves a lock by its unique key.
   *
   * @param key - The unique key identifying the lock.
   * @param tx - (Optional) The Prisma transaction client to use. Defaults to the main Prisma client.
   * @returns The Lock object if found, or null otherwise.
   */
  async getLockByKey(
    key: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Lock | null> {
    return await tx.lock.findUnique({ where: { key } });
  },

  /**
   * Atomically acquires a lock for the specified key and instance.
   * Sets the lock as locked, records the instance ID, and updates the lockedAt timestamp.
   *
   * @param key - The unique key identifying the lock.
   * @param instanceId - The identifier of the instance acquiring the lock.
   * @param tx - (Optional) The Prisma transaction client to use. Defaults to the main Prisma client.
   * @returns The updated Lock object.
   */
  async lockByKey(
    key: string,
    instanceId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Lock> {
    return await tx.lock.update({
      where: { key },
      data: { isLocked: true, lockedBy: instanceId, lockedAt: new Date() },
    });
  },

  /**
   * Releases (unlocks) the lock for the specified key.
   * Resets the lock state, clears the instance ID, and removes the lockedAt timestamp.
   *
   * @param key - The unique key identifying the lock.
   * @param tx - (Optional) The Prisma transaction client to use. Defaults to the main Prisma client.
   * @returns The updated Lock object.
   */
  async unlockByKey(
    key: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Lock> {
    return await tx.lock.update({
      where: {
        key,
      },
      data: {
        isLocked: false,
        lockedBy: null,
        lockedAt: null,
      },
    });
  },
};
