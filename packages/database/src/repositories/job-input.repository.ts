import prisma from "../client.js";
import type { JobInput, Prisma } from "../generated/prisma/client.js";

interface CreateJobInputData {
  input: string;
  inputHash: string;
  signature?: string | null;
}

/**
 * Repository for managing JobInput entities and related queries.
 * Provides methods for creating, retrieving, updating, and deleting JobInput records.
 */
export const jobInputRepository = {
  async createJobInputForEventId(
    eventId: string,
    data: CreateJobInputData,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobInput> {
    return await tx.jobInput.create({
      data: {
        event: { connect: { id: eventId } },
        input: data.input,
        inputHash: data.inputHash,
        signature: data.signature,
      },
    });
  },

  /**
   * Retrieves a JobInput by its ID
   */
  async getJobInputById(
    id: string,
    tx: Prisma.TransactionClient = prisma,
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
    tx: Prisma.TransactionClient = prisma,
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
    tx: Prisma.TransactionClient = prisma,
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
    tx: Prisma.TransactionClient = prisma,
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
