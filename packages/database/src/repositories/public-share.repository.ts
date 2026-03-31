import { v4 as uuidv4 } from "uuid";

import type { Prisma } from "../generated/prisma/client.js";
import { publicShareInclude } from "../types/public-share.js";

/**
 * Generic repository for managing token-based public shares across resources.
 */
export const publicShareRepository = {
  async getShareById(id: string, tx: Prisma.TransactionClient) {
    return await tx.publicShare.findUnique({
      where: { id },
      include: publicShareInclude,
    });
  },

  async getShareByToken(token: string, tx: Prisma.TransactionClient) {
    return await tx.publicShare.findUnique({
      where: { token },
      include: publicShareInclude,
    });
  },

  async upsertForJob(
    jobId: string,
    allowSearchIndexing: boolean = true,
    tx: Prisma.TransactionClient,
  ) {
    return await tx.publicShare.upsert({
      where: { jobId },
      create: {
        job: { connect: { id: jobId } },
        allowSearchIndexing,
        token: uuidv4(),
      },
      update: {
        allowSearchIndexing,
      },
      include: publicShareInclude,
    });
  },

  async upsertForTask(
    taskId: string,
    allowSearchIndexing: boolean = true,
    tx: Prisma.TransactionClient,
  ) {
    return await tx.publicShare.upsert({
      where: { taskId },
      create: {
        task: { connect: { id: taskId } },
        allowSearchIndexing,
        token: uuidv4(),
      },
      update: {
        allowSearchIndexing,
      },
      include: publicShareInclude,
    });
  },

  async deleteByJobId(jobId: string, tx: Prisma.TransactionClient) {
    return await tx.publicShare.deleteMany({
      where: { jobId },
    });
  },

  async deleteByTaskId(taskId: string, tx: Prisma.TransactionClient) {
    return await tx.publicShare.deleteMany({
      where: { taskId },
    });
  },
};
