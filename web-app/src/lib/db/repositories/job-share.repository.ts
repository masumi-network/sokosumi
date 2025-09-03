/**
 * Repository for managing JobShare entities and related queries.
 * Provides methods for creating, retrieving, and updating JobShare records.
 */

import {
  Prisma,
  ShareAccessType,
  SharePermission,
} from "@/prisma/generated/client";

import prisma from "./prisma";

export const jobShareRepository = {
  async getPublicJobShareByJobId(
    jobId: string,
    tx: Prisma.TransactionClient = prisma,
  ) {
    return await tx.jobShare.findFirst({
      where: {
        jobId,
        accessType: ShareAccessType.PUBLIC,
        permission: SharePermission.READ,
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
        accessType: shareAccessType,
        permission: sharePermission,
      },
    });
  },

  async deleteJobShare(jobId: string, tx: Prisma.TransactionClient = prisma) {
    return await tx.jobShare.deleteMany({
      where: { jobId },
    });
  },
};
