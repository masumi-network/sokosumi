import prisma from "../client.js";
import type { Prisma } from "../generated/prisma/client.js";
import { BlobOrigin, BlobStatus } from "../generated/prisma/client.js";
import { blobInclude, BlobWithJob } from "../types/blob.js";

/**
 * Repository for managing Blob entities and related queries.
 * Provides CRUD methods for Blob table.
 */
export const blobRepository = {
  /**
   * Create a new Blob record
   */
  async createBlob(
    userId: string,
    jobEventId: string,
    fileUrl: string,
    fileName?: string,
    size?: bigint,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<BlobWithJob> {
    return tx.blob.create({
      data: {
        user: { connect: { id: userId } },
        jobEvent: { connect: { id: jobEventId } },
        fileUrl,
        fileName,
        size,
      },
      include: blobInclude,
    });
  },

  /**
   * Create a pending result Blob record from a source URL (extracted from markdown)
   * Avoids duplicates by sourceUrl per job event.
   */
  async createPendingResultBlob(
    userId: string,
    jobEventId: string,
    sourceUrl: string,
    fileName?: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<BlobWithJob> {
    const existing = await tx.blob.findFirst({
      where: { jobEventId, sourceUrl },
      include: blobInclude,
    });
    if (existing) return existing;
    return tx.blob.create({
      data: {
        user: { connect: { id: userId } },
        jobEvent: { connect: { id: jobEventId } },
        origin: BlobOrigin.OUTPUT,
        status: BlobStatus.PENDING,
        sourceUrl,
        fileName,
      },
      include: blobInclude,
    });
  },

  /**
   * Get a Blob record by its ID
   */
  async getBlobById(
    id: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<BlobWithJob | null> {
    return tx.blob.findUnique({ where: { id }, include: blobInclude });
  },

  /**
   * Get all Blob records for a user
   */
  async getBlobsByUserId(
    userId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<BlobWithJob[]> {
    return tx.blob.findMany({ where: { userId }, include: blobInclude });
  },

  /**
   * Get all Blob records for a job event
   */
  async getBlobsByJobEventId(
    jobEventId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<BlobWithJob[]> {
    return tx.blob.findMany({ where: { jobEventId }, include: blobInclude });
  },

  /**
   * Get all Blob records for a job event by job id
   */
  async getBlobsByUserIdAndJobId(
    userId: string,
    jobId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<BlobWithJob[]> {
    return tx.blob.findMany({
      where: { userId, jobEvent: { jobId } },
      include: blobInclude,
    });
  },

  /**
   * Get pending result blobs to import.
   */
  async getPendingResultBlobs(
    limit?: number,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<BlobWithJob[]> {
    return tx.blob.findMany({
      where: { status: BlobStatus.PENDING, origin: BlobOrigin.OUTPUT },
      take: limit,
      orderBy: { createdAt: "asc" },
      include: blobInclude,
    });
  },

  /**
   * Update a Blob record by its ID
   */
  async updateBlobById(
    id: string,
    data: Prisma.BlobUpdateInput,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<BlobWithJob> {
    return tx.blob.update({ where: { id }, data, include: blobInclude });
  },

  async markBlobReady(
    id: string,
    updates: {
      fileUrl: string;
      mime?: string | null;
      size?: bigint | null;
      fileName?: string | null;
    },
    tx: Prisma.TransactionClient = prisma,
  ): Promise<BlobWithJob> {
    return tx.blob.update({
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
      include: blobInclude,
    });
  },

  async markBlobFailed(
    id: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<BlobWithJob> {
    return tx.blob.update({
      where: { id },
      data: { status: BlobStatus.FAILED },
      include: blobInclude,
    });
  },

  /**
   * Delete a Blob record by its ID
   */
  async deleteBlobById(
    id: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<BlobWithJob> {
    return tx.blob.delete({ where: { id }, include: blobInclude });
  },
};
