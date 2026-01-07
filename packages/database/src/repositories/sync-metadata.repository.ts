import prisma from "../client.js";
import type { Prisma, SyncMetadata } from "../generated/prisma/client.js";

/**
 * Repository for sync metadata management using the SyncMetadata model.
 * Provides methods to get and set sync timestamps for tracking incremental syncs.
 */
export const syncMetadataRepository = {
  /**
   * Retrieves the SyncMetadata object for the specified key.
   *
   * @param key - The unique key identifying the sync metadata entry.
   * @param tx - (Optional) The Prisma transaction client to use. Defaults to the main Prisma client.
   * @returns The last sync timestamp and cursor ID if found, or default values (0 for timestamp, null for cursor ID) otherwise.
   */
  async getSyncMetadataByKey(
    key: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<{ lastSyncedAt: Date; cursorId: string | null }> {
    const metadata = await tx.syncMetadata.findUnique({
      where: { key },
    });
    return {
      lastSyncedAt: metadata?.lastSyncedAt ?? new Date(0),
      cursorId: metadata?.cursorId ?? null,
    };
  },

  /**
   * Sets or updates the SyncMetadata object for the specified key.
   * Creates a new entry if it doesn't exist, or updates the existing one.
   *
   * @param key - The unique key identifying the sync metadata entry.
   * @param timestamp - The timestamp to store.
   * @param tx - (Optional) The Prisma transaction client to use. Defaults to the main Prisma client.
   * @returns The created or updated SyncMetadata object.
   */
  async setSyncMetadataByKey(
    key: string,
    cursorId: string,
    timestamp: Date,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<SyncMetadata> {
    return await tx.syncMetadata.upsert({
      where: { key },
      create: {
        key,
        lastSyncedAt: timestamp,
        cursorId,
      },
      update: {
        lastSyncedAt: timestamp,
        cursorId,
      },
    });
  },
};
