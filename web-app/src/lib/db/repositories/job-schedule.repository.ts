import "server-only";

import { CreateJobScheduleInputSchemaType } from "@/lib/schemas";
import { Prisma } from "@/prisma/generated/client";
import { InputJsonValue } from "@/prisma/generated/client/runtime/library";

import prisma from "./prisma";

export type ScheduleListItem = Prisma.JobScheduleGetPayload<{
  include: { agent: true };
}>;

export const jobScheduleRepository = {
  async create(
    data: CreateJobScheduleInputSchemaType,
    tx: Prisma.TransactionClient = prisma,
  ) {
    const payloadObj: Record<string, unknown> = {
      userId: data.userId,
      organizationId: data.organizationId,
      agentId: data.agentId,
      inputSchema: data.inputSchema as InputJsonValue,
      input: JSON.stringify(Object.fromEntries(data.inputData)),
      scheduleType:
        data.scheduleType as Prisma.JobScheduleCreateInput["scheduleType"],
      timezone: data.timezone,
      maxAcceptedCents: data.maxAcceptedCents,
      cron: data.cron,
      oneTimeAtUtc: data.oneTimeAtUtc,
      isActive: data.isActive,
      pauseReason: data.pauseReason,
      nextRunAt: data.nextRunAt,
      lastRunAt: data.lastRunAt,
    };
    const maybeEndOnUtc = (data as unknown as { endOnUtc?: string | null })
      .endOnUtc;
    if (maybeEndOnUtc !== undefined) payloadObj.endOnUtc = maybeEndOnUtc;
    const maybeEndAfter = (
      data as unknown as { endAfterOccurrences?: number | null }
    ).endAfterOccurrences;
    if (maybeEndAfter !== undefined)
      payloadObj.endAfterOccurrences = maybeEndAfter;

    return await tx.jobSchedule.create({
      data: payloadObj as unknown as Prisma.JobScheduleCreateInput,
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

  async findDue(limit: number = 50, tx: Prisma.TransactionClient = prisma) {
    return await tx.jobSchedule.findMany({
      where: {
        isActive: true,
        nextRunAt: { lte: new Date() },
      },
      orderBy: { nextRunAt: "asc" },
      take: limit,
    });
  },

  async getScheduleJobsByAgentIdAndContext(
    agentId: string,
    userId: string,
    organizationId: string | null,
    tx: Prisma.TransactionClient = prisma,
  ) {
    const organizationFilter: Prisma.JobScheduleWhereInput[] = organizationId
      ? [{ organizationId }, { organizationId: null }]
      : [{ organizationId: null }];

    return await tx.jobSchedule.findMany({
      where: {
        agentId,
        userId,
        OR: organizationFilter,
      },
      orderBy: { createdAt: "desc" },
      include: {
        agent: true,
      },
    });
  },

  async getScheduleJobsByContext(
    userId: string,
    organizationId: string | null,
    tx: Prisma.TransactionClient = prisma,
  ) {
    const organizationFilter: Prisma.JobScheduleWhereInput[] = organizationId
      ? [{ organizationId }, { organizationId: null }]
      : [{ organizationId: null }];

    return await tx.jobSchedule.findMany({
      where: {
        userId,
        AND: organizationFilter,
      },
      orderBy: { updatedAt: "desc" },
      include: {
        agent: true,
      },
    });
  },

  async markRunAttempt(id: string, tx: Prisma.TransactionClient = prisma) {
    return await tx.jobSchedule.update({
      where: { id },
      data: {
        lastRunAt: new Date(),
        // increment requires field to exist; cast to allow increment syntax
        ...({
          occurrenceCount: { increment: 1 },
        } as unknown as Prisma.JobScheduleUpdateInput),
      },
    });
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

  async setPaused(
    id: string,
    reason: string | null,
    tx: Prisma.TransactionClient = prisma,
  ) {
    return await tx.jobSchedule.update({
      where: { id },
      data: { isActive: false, pauseReason: reason },
    });
  },
};
