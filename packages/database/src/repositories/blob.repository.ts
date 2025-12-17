import prisma from "../client.js";
import type { Prisma } from "../generated/prisma/client.js";
import { Blob, BlobOrigin, BlobStatus } from "../generated/prisma/client.js";

/**
 * Repository for managing Blob entities and related queries.
 * Provides CRUD methods for Blob table.
 */
export const blobRepository = {
  async createInputBlobForEvent(
    userId: string,
    eventId: string,
    fileUrl: string,
    fileName?: string,
    size?: bigint,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Blob> {
    const blob = await tx.blob.create({
      data: {
        origin: BlobOrigin.INPUT,
        user: { connect: { id: userId } },
        event: { connect: { id: eventId } },
        status: BlobStatus.READY,
        fileUrl,
        fileName,
        size,
      },
    });
    return blob;
  },

  /**
   * Create a pending result Blob record from a source URL (extracted from markdown)
   * Avoids duplicates by sourceUrl per job event.
   */
  async upsertOutputBlob(
    userId: string,
    eventId: string,
    sourceUrl: string,
    fileName?: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Blob> {
    const blob = await tx.blob.upsert({
      where: {
        eventId_sourceUrl: { eventId, sourceUrl },
        userId,
      },
      update: {
        fileName,
      },
      create: {
        user: { connect: { id: userId } },
        event: { connect: { id: eventId } },
        origin: BlobOrigin.OUTPUT,
        status: BlobStatus.PENDING,
        sourceUrl,
        fileName,
      },
    });
    return blob;
  },

  /**
   * Get a Blob record by its ID
   */
  async getBlobById(
    id: string,
    tx: Prisma.TransactionClient = prisma,
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
    tx: Prisma.TransactionClient = prisma,
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
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Blob[]> {
    const blobs = await tx.blob.findMany({
      where: { eventId },
    });
    return blobs;
  },

  async getBlobsByJobInputId(
    jobInputId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Blob[]> {
    const blobs = await tx.blob.findMany({
      where: { event: { input: { id: jobInputId } } },
    });
    return blobs;
  },

  /**
   * Get all Blob records for a job
   */
  async getBlobsByJobId(
    jobId: string,
    tx: Prisma.TransactionClient = prisma,
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
    tx: Prisma.TransactionClient = prisma,
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
    limit?: number,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Blob[]> {
    const blobs = await tx.blob.findMany({
      where: { status: BlobStatus.PENDING, origin: BlobOrigin.OUTPUT },
      take: limit,
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
    tx: Prisma.TransactionClient = prisma,
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
    tx: Prisma.TransactionClient = prisma,
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
    tx: Prisma.TransactionClient = prisma,
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
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Blob | null> {
    const blob = await tx.blob.delete({ where: { id } });
    return blob;
  },
};
