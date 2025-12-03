import prisma from "../client.js";
import { AgentJobStatus } from "../generated/prisma/browser.js";
import type { JobEvent, Prisma } from "../generated/prisma/client.js";

interface CreateJobEventData {
  externalId?: string | null;
  status: AgentJobStatus;
  inputSchema?: string | null;
  result?: string | null;
  input?: string | null;
  inputHash?: string | null;
  signature?: string | null;
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
        input: data.input,
        inputHash: data.inputHash,
        signature: data.signature,
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
   * Retrieves all JobEvents with a specific externalId
   */
  async getJobEventsByExternalId(
    externalId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobEvent[]> {
    return await tx.jobEvent.findMany({
      where: { externalId },
      orderBy: { createdAt: "desc" },
    });
  },

  /**
   * Retrieves all JobEvents, optionally filtered by jobId
   */
  async getJobEvents(
    filters?: {
      jobId?: string;
      externalId?: string;
      status?: AgentJobStatus;
    },
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobEvent[]> {
    return await tx.jobEvent.findMany({
      where: {
        ...(filters?.jobId && { jobId: filters.jobId }),
        ...(filters?.externalId && { externalId: filters.externalId }),
        ...(filters?.status && { status: filters.status }),
      },
      orderBy: { createdAt: "desc" },
    });
  },

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
   * Retrieves a JobEvent by externalId for a specific job that is awaiting input
   */
  async getAwaitingInputJobEventByExternalId(
    externalId: string,
    jobId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobEvent | null> {
    return await tx.jobEvent.findFirst({
      where: {
        externalId,
        jobId,
        status: AgentJobStatus.AWAITING_INPUT,
      },
    });
  },

  async setInputForJobEventById(
    id: string,
    input: string,
    inputHash: string,
    signature: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobEvent> {
    return await tx.jobEvent.update({
      where: { id },
      data: { input, inputHash, signature },
    });
  },

  /**
   * Deletes a JobEvent by its ID
   */
  async deleteJobEventById(
    id: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobEvent> {
    return await tx.jobEvent.delete({
      where: { id },
    });
  },

  /**
   * Deletes all JobEvents for a specific job
   */
  async deleteJobEventsByJobId(
    jobId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<{ count: number }> {
    return await tx.jobEvent.deleteMany({
      where: { jobId },
    });
  },
};
