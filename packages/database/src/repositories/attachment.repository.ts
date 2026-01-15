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
   * Get all attachments for a user
   * Queries through the relationship chain: Attachment -> JobInput -> JobEvent -> Job -> User
   */
  async getAttachmentsByUserId(
    userId: string,
    tx: Prisma.TransactionClient,
  ): Promise<Attachment[]> {
    return await tx.attachment.findMany({
      where: {
        jobInput: {
          event: {
            job: {
              userId,
            },
          },
        },
      },
    });
  },
};
