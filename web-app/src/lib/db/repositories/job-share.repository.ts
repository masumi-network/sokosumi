/**
 * Repository for managing JobShare entities and related queries.
 * Provides methods for creating, retrieving, and updating JobShare records.
 */

import { v4 as uuidv4 } from "uuid";

import { Prisma, ShareAccessType } from "@/prisma/generated/client";

import prisma from "./prisma";

export const jobShareRepository = {
  async getJobShareById(id: string, tx: Prisma.TransactionClient = prisma) {
    return await tx.jobShare.findUnique({
      where: { id },
    });
  },

  async getJobShareByToken(
    token: string,
    tx: Prisma.TransactionClient = prisma,
  ) {
    return await tx.jobShare.findUnique({
      where: {
        token,
      },
    });
  },

  async createJobShare(
    jobId: string,
    userId: string,
    recipientOrganizationId: string | null,
    shareAccessType: ShareAccessType,
    tx: Prisma.TransactionClient = prisma,
  ) {
    return await tx.jobShare.create({
      data: {
        job: { connect: { id: jobId } },
        creator: { connect: { id: userId } },
        ...(recipientOrganizationId && {
          recipientOrganization: { connect: { id: recipientOrganizationId } },
        }),
        token: uuidv4(),
        accessType: shareAccessType,
      },
    });
  },

  async deleteJobShare(
    jobId: string,
    recipientOrganizationId: string | null,
    tx: Prisma.TransactionClient = prisma,
  ) {
    return await tx.jobShare.deleteMany({
      where: {
        jobId,
        recipientOrganizationId,
      },
    });
  },

  async updateJobShareAllowSearchIndexing(
    jobShareId: string,
    allowSearchIndexing: boolean,
    tx: Prisma.TransactionClient = prisma,
  ) {
    return await tx.jobShare.update({
      where: { id: jobShareId },
      data: { allowSearchIndexing },
    });
  },
};
