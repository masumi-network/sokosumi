import { AgentJobStatus } from "../generated/prisma/browser.js";
import type { JobEvent, Prisma } from "../generated/prisma/client.js";

interface CreateJobEventData {
  statusHash?: string | null;
  status: AgentJobStatus;
  inputSchema?: string | null;
  result?: string | null;
  inputId?: string | null;
}

export const jobEventRepository = {
  async createJobEventForJobId(
    jobId: string,
    data: CreateJobEventData,
    tx: Prisma.TransactionClient,
  ): Promise<JobEvent> {
    return await tx.jobEvent.create({
      data: {
        job: { connect: { id: jobId } },
        status: data.status,
        ...(data.statusHash !== undefined && { statusHash: data.statusHash }),
        ...(data.inputSchema !== undefined && {
          inputSchema: data.inputSchema,
        }),
        ...(data.result !== undefined && { result: data.result }),
        ...(data.inputId && { input: { connect: { id: data.inputId } } }),
      },
    });
  },

  async getLatestJobEventByJobId(
    jobId: string,
    tx: Prisma.TransactionClient,
  ): Promise<JobEvent | null> {
    return await tx.jobEvent.findFirst({
      where: { jobId },
      orderBy: { createdAt: "desc" },
    });
  },
};
