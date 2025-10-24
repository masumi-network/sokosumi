/**
 * Repository for managing JobShare entities and related queries.
 * Provides methods for creating, retrieving, and updating JobShare records.
 */

import { v4 as uuidv4 } from "uuid";

import { jobShareInclude } from "@/lib/db/types";
import { Prisma } from "@/prisma/generated/client";

import prisma from "./prisma";

export const jobShareRepository = {
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
      include: jobShareInclude,
    });
  },

  async getShareByToken(token: string, tx: Prisma.TransactionClient = prisma) {
    return await tx.jobShare.findUnique({
      where: {
        token,
      },
      include: jobShareInclude,
    });
  },

  async getShareByJobId(jobId: string, tx: Prisma.TransactionClient = prisma) {
    return await tx.jobShare.findUnique({
      where: { jobId },
      include: jobShareInclude,
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
        token: sharePublic ? uuidv4() : null,
      },
      include: jobShareInclude,
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
      include: jobShareInclude,
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
      include: jobShareInclude,
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
      include: jobShareInclude,
    });
  },
};
