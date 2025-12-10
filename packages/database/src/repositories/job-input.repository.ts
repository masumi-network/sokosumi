import prisma from "../client.js";
import type { JobInput, Prisma } from "../generated/prisma/client.js";

interface CreateJobInputData {
  externalId?: string | null;
  inputSchema?: string | null;
  input: string;
  inputHash: string;
  signature?: string | null;
}

/**
 * Repository for managing JobInput entities and related queries.
 * Provides methods for creating, retrieving, updating, and deleting JobInput records.
 */
export const jobInputRepository = {
  /**
   * Creates a new JobInput record for a specific job
   */
  async createJobInputForJobId(
    jobId: string,
    data: CreateJobInputData,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobInput> {
    return await tx.jobInput.create({
      data: {
        job: { connect: { id: jobId } },
        externalId: data.externalId,
        inputSchema: data.inputSchema,
        input: data.input,
        inputHash: data.inputHash,
        signature: data.signature,
      },
    });
  },

  async createJobInputForJobIdAndJobStatusId(
    jobId: string,
    jobStatusId: string,
    data: CreateJobInputData,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobInput> {
    return await tx.jobInput.create({
      data: {
        job: { connect: { id: jobId } },
        status: { connect: { id: jobStatusId } },
        externalId: data.externalId,
        inputSchema: data.inputSchema,
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
        job: true,
        status: true,
        blobs: true,
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
      where: { jobId },
    });
  },

  /**
   * Retrieves the JobInput for a specific job with related data
   */
  async getJobInputByJobIdWithRelations(
    jobId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobInput | null> {
    return await tx.jobInput.findFirst({
      where: { jobId },
      include: {
        job: true,
        status: true,
        blobs: true,
      },
    });
  },

  /**
   * Retrieves all JobInputs with a specific externalId
   */
  async getJobInputsByExternalId(
    externalId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobInput[]> {
    return await tx.jobInput.findMany({
      where: { externalId },
      orderBy: { createdAt: "desc" },
    });
  },

  /**
   * Retrieves all JobInputs, optionally filtered
   */
  async getJobInputs(
    filters?: {
      jobId?: string;
      externalId?: string;
    },
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobInput[]> {
    return await tx.jobInput.findMany({
      where: {
        ...(filters?.jobId && { jobId: filters.jobId }),
        ...(filters?.externalId && { externalId: filters.externalId }),
      },
      orderBy: { createdAt: "desc" },
    });
  },
};
