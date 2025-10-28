import "server-only";

import { CreateJobScheduleInputSchemaType } from "@/lib/schemas";
import { Prisma, ScheduleType } from "@/prisma/generated/client";
import { InputJsonValue } from "@/prisma/generated/client/runtime/library";

import prisma from "./prisma";

export type ScheduleListItem = Prisma.JobScheduleGetPayload<{
  include: {
    agent: true;
    jobs: {
      orderBy: { createdAt: "desc" };
      take: 1;
      select: { createdAt: true };
    };
  };
}>;

export const jobScheduleRepository = {
  async create(
    data: CreateJobScheduleInputSchemaType,
    tx: Prisma.TransactionClient = prisma,
  ) {
    const payloadObj: Prisma.JobScheduleCreateInput = {
      user: {
        connect: {
          id: data.userId,
        },
      },
      organization: data.organizationId
        ? {
            connect: {
              id: data.organizationId,
            },
          }
        : undefined,
      agent: {
        connect: {
          id: data.agentId,
        },
      },
      inputSchema: data.inputSchema as InputJsonValue,
      input: JSON.stringify(Object.fromEntries(data.inputData)),
      scheduleType: data.scheduleType as ScheduleType,
      timezone: data.timezone,
      maxAcceptedCents: data.maxAcceptedCents,
      cron: data.cron,
      oneTimeAtUtc: data.oneTimeAtUtc,
      isActive: data.isActive,
      pauseReason: data.pauseReason,
      nextRunAt: data.nextRunAt,
    };
    const maybeEndOnUtc = data.endOnUtc;
    if (maybeEndOnUtc !== undefined) payloadObj.endOnUtc = maybeEndOnUtc;
    const maybeEndAfter = data.endAfterOccurrences;
    if (maybeEndAfter !== undefined)
      payloadObj.endAfterOccurrences = maybeEndAfter;

    return await tx.jobSchedule.create({
      data: payloadObj,
    });
  },

  async update(
    id: string,
    data: Prisma.JobScheduleUpdateInput,
    tx: Prisma.TransactionClient = prisma,
  ) {
    return await tx.jobSchedule.update({ where: { id }, data });
  },

  async delete(id: string, tx: Prisma.TransactionClient = prisma) {
    return await tx.jobSchedule.delete({ where: { id } });
  },

  async getById(id: string, tx: Prisma.TransactionClient = prisma) {
    return await tx.jobSchedule.findUnique({ where: { id } });
  },

  async findDue(tx: Prisma.TransactionClient = prisma) {
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
    tx: Prisma.TransactionClient = prisma,
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

  async countJobs(id: string, tx: Prisma.TransactionClient = prisma) {
    return await tx.job.count({ where: { jobScheduleId: id } });
  },

  async setNextRun(
    id: string,
    nextRunAt: Date | null,
    tx: Prisma.TransactionClient = prisma,
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
    id: string,
    isActive: boolean,
    pauseReason?: string,
    tx: Prisma.TransactionClient = prisma,
  ) {
    return await tx.jobSchedule.update({
      where: { id },
      data: { isActive, pauseReason },
    });
  },
};
