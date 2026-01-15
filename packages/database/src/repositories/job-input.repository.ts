import type { JobInput, Prisma } from "../generated/prisma/client.js";
import { AttachmentData } from "./attachment.repository.js";

interface CreateJobInputData {
  input: string;
  inputHash: string | null;
  signature?: string | null;
  attachments?: AttachmentData[];
}

/**
 * Repository for managing JobInput entities and related queries.
 * Provides methods for creating, retrieving, updating, and deleting JobInput records.
 */
export const jobInputRepository = {
  async createJobInputForEventId(
    eventId: string,
    data: CreateJobInputData,
    tx: Prisma.TransactionClient,
  ): Promise<JobInput> {
    return await tx.jobInput.create({
      data: {
        event: { connect: { id: eventId } },
        input: data.input,
        inputHash: data.inputHash,
        signature: data.signature,
        attachments: {
          createMany: {
            data:
              data.attachments?.map((attachment) => ({
                url: attachment.url,
                name: attachment.name,
                mimeType: attachment.mimeType,
                size: attachment.size,
              })) ?? [],
          },
        },
      },
    });
  },

  /**
   * Retrieves a JobInput by its ID
   */
  async getJobInputById(
    id: string,
    tx: Prisma.TransactionClient,
  ): Promise<JobInput | null> {
    return await tx.jobInput.findUnique({
      where: { id },
    });
  },

  /**
   * Retrieves a JobInput by its ID with related data (job, status, blobs)
   */
  async getJobInputByIdWithRelations(
    id: string,
    tx: Prisma.TransactionClient,
  ): Promise<JobInput | null> {
    return await tx.jobInput.findUnique({
      where: { id },
      include: {
        event: {
          include: {
            job: true,
          },
        },
      },
    });
  },

  /**
   * Retrieves the JobInput for a specific job
   * Note: A job should have at most one JobInput
   */
  async getJobInputByJobId(
    jobId: string,
    tx: Prisma.TransactionClient,
  ): Promise<JobInput | null> {
    return await tx.jobInput.findFirst({
      where: { event: { jobId } },
    });
  },

  /**
   * Retrieves the JobInput for a specific job
   * Note: A job should have at most one JobInput
   */
  async getJobInputByJobIdWithRelations(
    jobId: string,
    tx: Prisma.TransactionClient,
  ): Promise<JobInput | null> {
    return await tx.jobInput.findFirst({
      where: { event: { jobId } },
      include: {
        event: {
          include: {
            job: true,
          },
        },
      },
    });
  },
};
