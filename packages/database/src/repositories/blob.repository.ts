import type { Prisma } from "../generated/prisma/client.js";
import { type Blob, BlobStatus } from "../generated/prisma/client.js";

/**
 * Repository for managing Blob entities and related queries.
 * Provides CRUD methods for Blob table.
 * This repository handles result blobs from agent jobs.
 */
export const blobRepository = {
  /**
   * Insert PENDING result Blobs from source URLs extracted from markdown,
   * skipping ones already stored. `skipDuplicates` skips a row that collides
   * with any unique on the model, not only `eventId_sourceUrl`; today that
   * unique and the primary key are the only ones. One statement covers the
   * batch, and Prisma splits a very large one into chunks. The per-URL upsert
   * this replaced spent a nested write, and so an implicit transaction, on
   * every URL.
   */
  async createOutputBlobs(
    data: {
      eventId: string;
      sourceUrl: string;
      name?: string;
    }[],
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.blob.createMany({
      data: data.map((blob) => ({ ...blob, status: BlobStatus.PENDING })),
      skipDuplicates: true,
    });
  },

  /**
   * Get a Blob record by its ID
   */
  async getBlobById(
    id: string,
    tx: Prisma.TransactionClient,
  ): Promise<Blob | null> {
    const blob = await tx.blob.findUnique({
      where: { id },
    });
    return blob;
  },

  /**
   * Get all Blob records for a user
   */
  /**
   * Get all Blob records for a user
   * Queries through the relationship chain: Blob -> JobEvent -> Job -> User
   */
  async getBlobsByUserId(
    userId: string,
    tx: Prisma.TransactionClient,
  ): Promise<Blob[]> {
    const blobs = await tx.blob.findMany({
      where: {
        event: {
          job: {
            ownerId: userId,
          },
        },
      },
    });
    return blobs;
  },

  /**
   * Get all Blob records for a job event
   */
  async getBlobsByEventId(
    eventId: string,
    tx: Prisma.TransactionClient,
  ): Promise<Blob[]> {
    const blobs = await tx.blob.findMany({
      where: { eventId },
    });
    return blobs;
  },

  /**
   * Get all Blob records for a job
   */
  async getBlobsByJobId(
    jobId: string,
    tx: Prisma.TransactionClient,
  ): Promise<Blob[]> {
    const blobs = await tx.blob.findMany({
      where: {
        event: { job: { id: jobId } },
      },
    });
    return blobs;
  },

  /**
   * Get pending blobs to import.
   */
  async getPendingBlobs(
    data: {
      limit?: number;
    },
    tx: Prisma.TransactionClient,
  ): Promise<Blob[]> {
    return await tx.blob.findMany({
      where: { status: BlobStatus.PENDING },
      take: data.limit,
      orderBy: { createdAt: "asc" },
    });
  },

  /**
   * Update a Blob record by its ID
   */
  async updateBlobById(
    id: string,
    data: Prisma.BlobUpdateInput,
    tx: Prisma.TransactionClient,
  ): Promise<Blob> {
    const blob = await tx.blob.update({
      where: { id },
      data,
    });
    return blob;
  },

  async markBlobReady(
    id: string,
    updates: {
      fileUrl: string;
      mimeType?: string | null;
      size?: bigint | null;
      name?: string | null;
    },
    tx: Prisma.TransactionClient,
  ): Promise<Blob> {
    const blob = await tx.blob.update({
      where: { id },
      data: {
        fileUrl: updates.fileUrl,
        mimeType: updates.mimeType,
        size: updates.size,
        name: updates.name,
        status: BlobStatus.READY,
      },
    });
    return blob;
  },

  async markBlobFailed(
    id: string,
    tx: Prisma.TransactionClient,
  ): Promise<Blob> {
    const blob = await tx.blob.update({
      where: { id },
      data: { status: BlobStatus.FAILED },
    });
    return blob;
  },

  /**
   * Delete a Blob record by its ID
   */
  async deleteBlobById(
    id: string,
    tx: Prisma.TransactionClient,
  ): Promise<Blob | null> {
    const blob = await tx.blob.delete({ where: { id } });
    return blob;
  },
};
