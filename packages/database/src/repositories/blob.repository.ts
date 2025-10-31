import "server-only";

import prisma from "../client";
import type { Blob, Prisma } from "../generated/prisma/client";
import { BlobOrigin, BlobStatus } from "../generated/prisma/client";

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
    jobId: string,
    fileUrl: string,
    fileName?: string,
    size?: bigint,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Blob> {
    return tx.blob.create({
      data: {
        user: { connect: { id: userId } },
        job: { connect: { id: jobId } },
        fileUrl,
        fileName,
        size,
      },
    });
  },

  /**
   * Create a pending output Blob record from a source URL (extracted from markdown)
   * Avoids duplicates by sourceUrl per job.
   */
  async createPendingOutputBlob(
    userId: string,
    jobId: string,
    sourceUrl: string,
    fileName?: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Blob> {
    const existing = await tx.blob.findFirst({
      where: { jobId, sourceUrl },
    });
    if (existing) return existing;
    return tx.blob.create({
      data: {
        user: { connect: { id: userId } },
        job: { connect: { id: jobId } },
        origin: BlobOrigin.OUTPUT,
        status: BlobStatus.PENDING,
        sourceUrl,
        fileName,
      },
    });
  },

  /**
   * Get a Blob record by its ID
   */
  async getBlobById(
    id: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Blob | null> {
    return tx.blob.findUnique({ where: { id } });
  },

  /**
   * Get all Blob records for a user
   */
  async getBlobsByUserId(
    userId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Blob[]> {
    return tx.blob.findMany({ where: { userId } });
  },

  /**
   * Get all Blob records for a job
   */
  async getBlobsByJobId(
    jobId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Blob[]> {
    return tx.blob.findMany({ where: { jobId } });
  },

  /**
   * Get pending output blobs to import.
   */
  async getPendingOutputBlobs(
    limit?: number,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Blob[]> {
    return tx.blob.findMany({
      where: { status: BlobStatus.PENDING, origin: BlobOrigin.OUTPUT },
      take: limit,
      orderBy: { createdAt: "asc" },
    });
  },

  /**
   * Update a Blob record by its ID
   */
  async updateBlobById(
    id: string,
    data: Prisma.BlobUpdateInput,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Blob> {
    return tx.blob.update({ where: { id }, data });
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
  ): Promise<Blob> {
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
    });
  },

  async markBlobFailed(
    id: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Blob> {
    return tx.blob.update({
      where: { id },
      data: { status: BlobStatus.FAILED },
    });
  },

  /**
   * Delete a Blob record by its ID
   */
  async deleteBlobById(
    id: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Blob> {
    return tx.blob.delete({ where: { id } });
  },
};
