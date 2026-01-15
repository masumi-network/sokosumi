import type { Prisma } from "../generated/prisma/client.js";
import { Blob, BlobOrigin, BlobStatus } from "../generated/prisma/client.js";

/**
 * Repository for managing Blob entities and related queries.
 * Provides CRUD methods for Blob table.
 * Note: INPUT blobs have been migrated to the Attachment table.
 * This repository now only handles OUTPUT blobs.
 */
export const blobRepository = {
  /**
   * Create a pending result Blob record from a source URL (extracted from markdown)
   * Avoids duplicates by sourceUrl per job event.
   */
  async upsertOutputBlob(
    data: {
      userId: string;
      eventId: string;
      sourceUrl: string;
      fileName?: string;
    },
    tx: Prisma.TransactionClient,
  ): Promise<Blob> {
    const blob = await tx.blob.upsert({
      where: {
        eventId_sourceUrl: { eventId: data.eventId, sourceUrl: data.sourceUrl },
        userId: data.userId,
      },
      update: {
        fileName: data.fileName,
      },
      create: {
        user: { connect: { id: data.userId } },
        event: { connect: { id: data.eventId } },
        origin: BlobOrigin.OUTPUT,
        status: BlobStatus.PENDING,
        sourceUrl: data.sourceUrl,
        fileName: data.fileName,
      },
    });
    return blob;
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
  async getBlobsByUserId(
    userId: string,
    tx: Prisma.TransactionClient,
  ): Promise<Blob[]> {
    const blobs = await tx.blob.findMany({
      where: { userId },
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
   * Get all Blob records for a job event by job id
   */
  async getBlobsByUserIdAndJobId(
    userId: string,
    jobId: string,
    tx: Prisma.TransactionClient,
  ): Promise<Blob[]> {
    const blobs = await tx.blob.findMany({
      where: {
        userId,
        event: { job: { id: jobId } },
      },
    });
    return blobs;
  },

  /**
   * Get pending output blobs to import.
   */
  async getPendingOutputBlobs(
    data: {
      limit?: number;
    },
    tx: Prisma.TransactionClient,
  ): Promise<Blob[]> {
    const blobs = await tx.blob.findMany({
      where: { status: BlobStatus.PENDING, origin: BlobOrigin.OUTPUT },
      take: data.limit,
      orderBy: { createdAt: "asc" },
    });
    return blobs;
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
      mime?: string | null;
      size?: bigint | null;
      fileName?: string | null;
    },
    tx: Prisma.TransactionClient,
  ): Promise<Blob> {
    const blob = await tx.blob.update({
      where: { id },
      data: {
        fileUrl: updates.fileUrl,
        mime: updates.mime ?? undefined,
        size: typeof updates.size !== "undefined" ? updates.size : undefined,
        ...(typeof updates.fileName !== "undefined" && {
          fileName: updates.fileName,
        }),
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
