import prisma from "../client.js";
import { AgentJobStatus } from "../generated/prisma/browser.js";
import type { JobStatus, Prisma } from "../generated/prisma/client.js";

interface CreateJobStatusData {
  externalId?: string | null;
  status: AgentJobStatus;
  inputSchema?: string | null;
  result?: string | null;
  inputId?: string | null;
}

/**
 * Repository for managing JobStatus entities and related queries.
 * Provides methods for creating, retrieving, updating, and deleting JobStatus records.
 */
export const jobStatusRepository = {
  /**
   * Creates a new JobStatus record
   */
  async createJobStatusForJobId(
    jobId: string,
    data: CreateJobStatusData,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobStatus> {
    return await tx.jobStatus.create({
      data: {
        job: { connect: { id: jobId } },
        externalId: data.externalId,
        status: data.status,
        inputSchema: data.inputSchema,
        result: data.result,
        ...(data.inputId && { input: { connect: { id: data.inputId } } }),
      },
    });
  },

  /**
   * Retrieves a JobStatus by its ID
   */
  async getJobStatusById(
    id: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobStatus | null> {
    return await tx.jobStatus.findUnique({
      where: { id },
    });
  },

  /**
   * Retrieves all JobStatuses for a specific job, ordered by creation date (newest first)
   */
  async getJobStatusesByJobId(
    jobId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobStatus[]> {
    return await tx.jobStatus.findMany({
      where: { jobId },
      orderBy: { createdAt: "desc" },
    });
  },

  /**
   * Retrieves the latest JobStatus for a specific job
   */
  async getLatestJobStatusByJobId(
    jobId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobStatus | null> {
    return await tx.jobStatus.findFirst({
      where: { jobId },
      orderBy: { createdAt: "desc" },
    });
  },

  /**
   * Retrieves a JobStatus for a specific job that is awaiting input
   */
  async getAwaitingInputJobStatusByJobId(
    jobId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobStatus | null> {
    return await tx.jobStatus.findFirst({
      where: {
        jobId,
        status: AgentJobStatus.AWAITING_INPUT,
      },
    });
  },

  async getAwaitingInputJobStatusByJobIdAndExternalId(
    jobId: string,
    externalId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobStatus | null> {
    return await tx.jobStatus.findFirst({
      where: { externalId, jobId, status: AgentJobStatus.AWAITING_INPUT },
    });
  },
};
