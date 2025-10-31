
import prisma from "../client";
import type { Prisma } from "../generated/prisma/client";

export const jobScheduleRepository = {
  async create(
    data: Prisma.JobScheduleCreateInput,
    tx: Prisma.TransactionClient = prisma,
  ) {
    return await tx.jobSchedule.create({
      data,
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
