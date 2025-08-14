import prisma from "@/lib/db/repositories/prisma";
import { Prisma, UploadFiles } from "@/prisma/generated/client";

/**
 * Repository for managing UploadFiles entities and related queries.
 * Provides CRUD methods for UploadFiles table.
 */
export const uploadFilesRepository = {
  /**
   * Create a new UploadFiles record
   */
  async createUploadFile(
    userId: string,
    jobId: string,
    fileUrl: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<UploadFiles> {
    return tx.uploadFiles.create({
      data: {
        user: { connect: { id: userId } },
        job: { connect: { id: jobId } },
        fileUrl,
      },
    });
  },

  /**
   * Get an UploadFiles record by its ID
   */
  async getUploadFileById(
    id: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<UploadFiles | null> {
    return tx.uploadFiles.findUnique({ where: { id } });
  },

  /**
   * Get all UploadFiles records for a user
   */
  async getUploadFilesByUserId(
    userId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<UploadFiles[]> {
    return tx.uploadFiles.findMany({ where: { userId } });
  },

  /**
   * Get all UploadFiles records for a job
   */
  async getUploadFilesByJobId(
    jobId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<UploadFiles[]> {
    return tx.uploadFiles.findMany({ where: { jobId } });
  },

  /**
   * Update an UploadFiles record by its ID
   */
  async updateUploadFileById(
    id: string,
    data: Prisma.UploadFilesUpdateInput,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<UploadFiles> {
    return tx.uploadFiles.update({ where: { id }, data });
  },

  /**
   * Delete an UploadFiles record by its ID
   */
  async deleteUploadFileById(
    id: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<UploadFiles> {
    return tx.uploadFiles.delete({ where: { id } });
  },
};
