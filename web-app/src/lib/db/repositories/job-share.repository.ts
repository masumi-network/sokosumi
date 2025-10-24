/**
 * Repository for managing JobShare entities and related queries.
 * Provides methods for creating, retrieving, and updating JobShare records.
 */

import { v4 as uuidv4 } from "uuid";

import { jobPublicShareInclude } from "@/lib/db/types";
import { Prisma } from "@/prisma/generated/client";

import prisma from "./prisma";

export const jobPublicShareRepository = {
  async hasShareByJobId(jobId: string, tx: Prisma.TransactionClient = prisma) {
    const share = await tx.jobShare.findUnique({
      where: { jobId },
      select: { id: true },
    });
    return share !== null;
  },

  async getShareById(id: string, tx: Prisma.TransactionClient = prisma) {
    return await tx.jobShare.findUnique({
      where: { id },
      include: jobPublicShareInclude,
    });
  },

  async getShareByToken(token: string, tx: Prisma.TransactionClient = prisma) {
    return await tx.jobShare.findUnique({
      where: {
        token,
      },
      include: jobPublicShareInclude,
    });
  },

  async getShareByJobId(jobId: string, tx: Prisma.TransactionClient = prisma) {
    return await tx.jobShare.findUnique({
      where: { jobId },
      include: jobPublicShareInclude,
    });
  },

  async upsertShare(
    jobId: string,
    sharePublic: boolean,
    organizationId: string | null,
    allowSearchIndexing: boolean,
    tx: Prisma.TransactionClient = prisma,
  ) {
    return await tx.jobShare.upsert({
      where: { jobId },
      create: {
        jobId,
        allowSearchIndexing,
        token: sharePublic ? uuidv4() : null,
        organizationId,
      },
      update: {
        allowSearchIndexing,
        organization: organizationId
          ? { connect: { id: organizationId } }
          : { disconnect: true },
      },
      include: jobPublicShareInclude,
    });
  },

  async setShareOrganizationById(
    id: string,
    organizationId: string | null,
    tx: Prisma.TransactionClient = prisma,
  ) {
    return await tx.jobShare.update({
      where: { id },
      data: {
        organization: organizationId
          ? { connect: { id: organizationId } }
          : { disconnect: true },
      },
      include: jobPublicShareInclude,
    });
  },

  async setSharePublicById(
    id: string,
    sharePublic: boolean,
    tx: Prisma.TransactionClient = prisma,
  ) {
    return await tx.jobShare.update({
      where: { id },
      data: { token: sharePublic ? uuidv4() : null },
      include: jobPublicShareInclude,
    });
  },

  async deleteShareById(id: string, tx: Prisma.TransactionClient = prisma) {
    return await tx.jobShare.delete({
      where: { id },
    });
  },

  async deleteShareByJobId(
    jobId: string,
    tx: Prisma.TransactionClient = prisma,
  ) {
    return await tx.jobShare.deleteMany({
      where: { jobId },
    });
  },

  async setShareAllowSearchIndexingById(
    id: string,
    allowSearchIndexing: boolean,
    tx: Prisma.TransactionClient = prisma,
  ) {
    return await tx.jobShare.update({
      where: { id },
      data: { allowSearchIndexing },
      include: jobPublicShareInclude,
    });
  },
};
