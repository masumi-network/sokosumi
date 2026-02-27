import { hashInputSchema } from "@sokosumi/masumi/hash";

import type { Prisma } from "../generated/prisma/client.js";

function getRequiredInputSchemaHash(inputSchema: string): string {
  const inputSchemaHash = hashInputSchema(inputSchema);
  if (!inputSchemaHash) {
    throw new Error("Failed to hash input schema");
  }

  return inputSchemaHash;
}

function getCreateInputSchema(
  data: Omit<Prisma.JobScheduleCreateInput, "inputSchemaHash">,
): string {
  if (typeof data.inputSchema !== "string") {
    throw new Error("JobSchedule inputSchema must be a JSON string");
  }

  return data.inputSchema;
}

function getUpdateInputSchema(
  data: Prisma.JobScheduleUpdateInput,
): string | undefined {
  if (typeof data.inputSchema === "string") {
    return data.inputSchema;
  }

  if (
    data.inputSchema &&
    typeof data.inputSchema === "object" &&
    "set" in data.inputSchema &&
    typeof data.inputSchema.set === "string"
  ) {
    return data.inputSchema.set;
  }

  return undefined;
}

export const jobScheduleRepository = {
  async create(
    data: Omit<Prisma.JobScheduleCreateInput, "inputSchemaHash">,
    tx: Prisma.TransactionClient,
  ) {
    const inputSchemaHash = getRequiredInputSchemaHash(getCreateInputSchema(data));

    return await tx.jobSchedule.create({
      data: {
        ...data,
        inputSchemaHash,
      },
    });
  },

  async update(
    id: string,
    data: Prisma.JobScheduleUpdateInput,
    tx: Prisma.TransactionClient,
  ) {
    const inputSchema = getUpdateInputSchema(data);
    const updateData =
      inputSchema === undefined
        ? data
        : {
            ...data,
            inputSchemaHash: getRequiredInputSchemaHash(inputSchema),
          };

    return await tx.jobSchedule.update({ where: { id }, data: updateData });
  },

  async delete(id: string, tx: Prisma.TransactionClient) {
    return await tx.jobSchedule.delete({ where: { id } });
  },

  async getById(id: string, tx: Prisma.TransactionClient) {
    return await tx.jobSchedule.findUnique({ where: { id } });
  },

  async findDue(tx: Prisma.TransactionClient) {
    return await tx.jobSchedule.findMany({
      where: {
        isActive: true,
        nextRunAt: { lte: new Date() },
      },
      orderBy: { nextRunAt: "asc" },
    });
  },

  async getScheduleJobsByContext(
    userId: string,
    organizationId: string | null,
    tx: Prisma.TransactionClient,
  ) {
    return await tx.jobSchedule.findMany({
      where: {
        userId,
        organizationId: organizationId ?? null,
      },
      orderBy: { updatedAt: "desc" },
      include: {
        agent: true,
        jobs: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true },
        },
      },
    });
  },

  async countJobs(id: string, tx: Prisma.TransactionClient) {
    return await tx.job.count({ where: { jobScheduleId: id } });
  },

  async setNextRun(
    id: string,
    nextRunAt: Date | null,
    tx: Prisma.TransactionClient,
  ) {
    return await tx.jobSchedule.update({
      where: { id },
      data: {
        nextRunAt,
        isActive: nextRunAt ? true : false,
        pauseReason: null,
      },
    });
  },

  async setActive(
    data: {
      id: string;
      isActive: boolean;
      pauseReason?: string;
    },
    tx: Prisma.TransactionClient,
  ) {
    return await tx.jobSchedule.update({
      where: { id: data.id },
      data: { isActive: data.isActive, pauseReason: data.pauseReason },
    });
  },
};
