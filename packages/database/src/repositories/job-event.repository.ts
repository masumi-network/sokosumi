import prisma from "../client.js";
import { AgentJobStatus } from "../generated/prisma/browser.js";
import type { JobEvent, Prisma } from "../generated/prisma/client.js";

interface CreateJobEventData {
  externalId?: string | null;
  status: AgentJobStatus;
  inputSchema?: string | null;
  result?: string | null;
  inputId?: string | null;
}

/**
 * Repository for managing JobEvent entities and related queries.
 * Provides methods for creating, retrieving, updating, and deleting JobEvent records.
 */
export const jobEventRepository = {
  /**
   * Creates a new JobEvent record
   */
  async createJobEventForJobId(
    jobId: string,
    data: CreateJobEventData,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobEvent> {
    return await tx.jobEvent.create({
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
   * Retrieves a JobEvent by its ID
   */
  async getJobEventById(
    id: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobEvent | null> {
    return await tx.jobEvent.findUnique({
      where: { id },
    });
  },

  /**
   * Retrieves all JobEvents for a specific job, ordered by creation date (newest first)
   */
  async getJobEventsByJobId(
    jobId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobEvent[]> {
    return await tx.jobEvent.findMany({
      where: { jobId },
      orderBy: { createdAt: "desc" },
    });
  },

  /**
   * Retrieves the latest JobEvent for a specific job
   */
  async getLatestJobEventByJobId(
    jobId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobEvent | null> {
    return await tx.jobEvent.findFirst({
      where: { jobId },
      orderBy: { createdAt: "desc" },
    });
  },

  /**
   * Retrieves a JobEvent for a specific job that is awaiting input
   */
  async getAwaitingInputJobEventByJobId(
    jobId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobEvent | null> {
    return await tx.jobEvent.findFirst({
      where: {
        jobId,
        status: AgentJobStatus.AWAITING_INPUT,
      },
    });
  },

  async getAwaitingInputJobEventByJobIdAndExternalId(
    jobId: string,
    externalId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobEvent | null> {
    return await tx.jobEvent.findFirst({
      where: { externalId, jobId, status: AgentJobStatus.AWAITING_INPUT },
    });
  },
};
