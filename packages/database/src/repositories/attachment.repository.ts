import type { Attachment, Prisma } from "../generated/prisma/client.js";

export interface AttachmentData {
  url: string;
  name?: string;
  mimeType?: string;
  size?: bigint;
}

/**
 * Repository for managing Attachment entities and related queries.
 * Provides CRUD methods for Attachment table.
 */
export const attachmentRepository = {
  /**
   * Get all attachments for a JobInput
   */
  async getAttachmentsByJobInputId(
    jobInputId: string,
    tx: Prisma.TransactionClient,
  ): Promise<Attachment[]> {
    return await tx.attachment.findMany({
      where: { jobInputId },
    });
  },

  async getAttachmendByJobId(
    jobId: string,
    tx: Prisma.TransactionClient,
  ): Promise<Attachment[]> {
    return await tx.attachment.findMany({
      where: { jobInput: { event: { jobId } } },
    });
  },

  /**
   * Get all attachments for a Task
   */
  async getAttachmentsByTaskId(
    taskId: string,
    tx: Prisma.TransactionClient,
  ): Promise<Attachment[]> {
    return await tx.attachment.findMany({
      where: { taskId },
    });
  },

  /**
   * Get all attachments for a TaskComment
   */
  async getAttachmentsByTaskCommentId(
    taskCommentId: string,
    tx: Prisma.TransactionClient,
  ): Promise<Attachment[]> {
    return await tx.attachment.findMany({
      where: { taskCommentId },
    });
  },

  /**
   * Get all attachments for a user
   * Queries through relationship chains for all three entity types:
   * - Attachment -> JobInput -> JobEvent -> Job -> User
   * - Attachment -> Task -> User
   * - Attachment -> TaskComment -> Task -> User
   */
  async getAttachmentsByUserId(
    userId: string,
    tx: Prisma.TransactionClient,
  ): Promise<Attachment[]> {
    return await tx.attachment.findMany({
      where: {
        OR: [
          { jobInput: { event: { job: { userId } } } },
          { task: { userId } },
          { taskComment: { task: { userId } } },
        ],
      },
    });
  },
};
