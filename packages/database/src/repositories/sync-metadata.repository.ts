import prisma from "../client.js";
import type { Prisma, SyncMetadata } from "../generated/prisma/client.js";

/**
 * Repository for sync metadata management using the SyncMetadata model.
 * Provides methods to get and set sync timestamps for tracking incremental syncs.
 */
export const syncMetadataRepository = {
  /**
   * Retrieves the last sync timestamp for the specified key.
   *
   * @param key - The unique key identifying the sync metadata entry.
   * @param tx - (Optional) The Prisma transaction client to use. Defaults to the main Prisma client.
   * @returns The last sync timestamp as a Date if found, or null otherwise.
   */
  async getLastSyncTimestamp(
    key: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Date | null> {
    const metadata = await tx.syncMetadata.findUnique({
      where: { key },
    });
    return metadata?.lastSyncedAt ?? null;
  },

  /**
   * Sets or updates the last sync timestamp for the specified key.
   * Creates a new entry if it doesn't exist, or updates the existing one.
   *
   * @param key - The unique key identifying the sync metadata entry.
   * @param timestamp - The timestamp to store.
   * @param tx - (Optional) The Prisma transaction client to use. Defaults to the main Prisma client.
   * @returns The created or updated SyncMetadata object.
   */
  async setLastSyncTimestamp(
    key: string,
    timestamp: Date,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<SyncMetadata> {
    return await tx.syncMetadata.upsert({
      where: { key },
      create: {
        key,
        lastSyncedAt: timestamp,
      },
      update: {
        lastSyncedAt: timestamp,
      },
    });
  },
};
