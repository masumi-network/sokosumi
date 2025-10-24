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
    const share = await tx.jobPublicShare.findUnique({
      where: { jobId },
      select: { id: true },
    });
    return share !== null;
  },

  async getShareById(id: string, tx: Prisma.TransactionClient = prisma) {
    return await tx.jobPublicShare.findUnique({
      where: { id },
      include: jobPublicShareInclude,
    });
  },

  async getShareByToken(token: string, tx: Prisma.TransactionClient = prisma) {
    return await tx.jobPublicShare.findUnique({
      where: {
        token,
      },
      include: jobPublicShareInclude,
    });
  },

  async getShareByJobId(jobId: string, tx: Prisma.TransactionClient = prisma) {
    return await tx.jobPublicShare.findUnique({
      where: { jobId },
      include: jobPublicShareInclude,
    });
  },

  async upsertShare(
    jobId: string,
    allowSearchIndexing: boolean,
    tx: Prisma.TransactionClient = prisma,
  ) {
    return await tx.jobPublicShare.upsert({
      where: { jobId },
      create: { jobId, allowSearchIndexing, token: uuidv4() },
      update: { allowSearchIndexing },
      include: jobPublicShareInclude,
    });
  },

  async deleteShareById(id: string, tx: Prisma.TransactionClient = prisma) {
    return await tx.jobPublicShare.delete({
      where: { id },
    });
  },

  async deleteShareByJobId(
    jobId: string,
    tx: Prisma.TransactionClient = prisma,
  ) {
    return await tx.jobPublicShare.deleteMany({
      where: { jobId },
    });
  },

  async setShareAllowSearchIndexingById(
    id: string,
    allowSearchIndexing: boolean,
    tx: Prisma.TransactionClient = prisma,
  ) {
    return await tx.jobPublicShare.update({
      where: { id },
      data: { allowSearchIndexing },
      include: jobPublicShareInclude,
    });
  },
};
