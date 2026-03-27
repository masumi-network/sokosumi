import { v4 as uuidv4 } from "uuid";

import type { Prisma } from "../generated/prisma/client.js";
import { jobShareInclude } from "../types/job-share.js";

/**
 * Repository for managing JobShare entities and related queries.
 * Provides methods for creating, retrieving, and updating JobShare records.
 */
export const jobShareRepository = {
  async getShareById(id: string, tx: Prisma.TransactionClient) {
    return await tx.jobShare.findUnique({
      where: { id },
      include: jobShareInclude,
    });
  },

  async getShareByToken(token: string, tx: Prisma.TransactionClient) {
    return await tx.jobShare.findUnique({
      where: {
        token,
      },
      include: jobShareInclude,
    });
  },

  async upsertPublicShare(
    jobId: string,
    allowSearchIndexing: boolean = true,
    tx: Prisma.TransactionClient,
  ) {
    return await tx.jobShare.upsert({
      where: { jobId },
      create: {
        job: { connect: { id: jobId } },
        allowSearchIndexing,
        token: uuidv4(),
      },
      update: {
        allowSearchIndexing,
      },
      include: jobShareInclude,
    });
  },

  async deleteShareByJobId(jobId: string, tx: Prisma.TransactionClient) {
    return await tx.jobShare.deleteMany({
      where: { jobId },
    });
  },

  async setShareAllowSearchIndexingById(
    id: string,
    allowSearchIndexing: boolean,
    tx: Prisma.TransactionClient,
  ) {
    return await tx.jobShare.update({
      where: { id },
      data: { allowSearchIndexing },
      include: jobShareInclude,
    });
  },
};
