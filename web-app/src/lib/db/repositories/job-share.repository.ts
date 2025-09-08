/**
 * Repository for managing JobShare entities and related queries.
 * Provides methods for creating, retrieving, and updating JobShare records.
 */

import { v4 as uuidv4 } from "uuid";

import {
  Prisma,
  ShareAccessType,
  SharePermission,
} from "@/prisma/generated/client";

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
    creatorId: string,
    recipientId: string | null,
    recipientOrganizationId: string | null,
    shareAccessType: ShareAccessType,
    sharePermission: SharePermission,
    tx: Prisma.TransactionClient = prisma,
  ) {
    return await tx.jobShare.create({
      data: {
        job: { connect: { id: jobId } },
        creator: { connect: { id: creatorId } },
        ...(recipientId && { recipient: { connect: { id: recipientId } } }),
        ...(recipientOrganizationId && {
          recipientOrganization: { connect: { id: recipientOrganizationId } },
        }),
        token: uuidv4(),
        accessType: shareAccessType,
        permission: sharePermission,
      },
    });
  },

  async deleteJobSharesByJobId(
    jobId: string,
    tx: Prisma.TransactionClient = prisma,
  ) {
    return await tx.jobShare.deleteMany({
      where: { jobId },
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
