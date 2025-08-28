import prisma from "@/lib/db/repositories/prisma";
import { Blob, Prisma } from "@/prisma/generated/client";

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
   * Update a Blob record by its ID
   */
  async updateBlobById(
    id: string,
    data: Prisma.BlobUpdateInput,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Blob> {
    return tx.blob.update({ where: { id }, data });
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
