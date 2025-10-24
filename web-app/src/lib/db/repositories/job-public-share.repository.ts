/**
 * Repository for managing JobShare entities and related queries.
 * Provides methods for creating, retrieving, and updating JobShare records.
 */

import { v4 as uuidv4 } from "uuid";

import { Prisma } from "@/prisma/generated/client";

import prisma from "./prisma";

export const jobPublicShareRepository = {
  async getShareById(id: string, tx: Prisma.TransactionClient = prisma) {
    return await tx.jobPublicShare.findUnique({
      where: { id },
    });
  },

  async getShareByToken(token: string, tx: Prisma.TransactionClient = prisma) {
    return await tx.jobPublicShare.findUnique({
      where: {
        token,
      },
    });
  },

  async getShareByJobId(jobId: string, tx: Prisma.TransactionClient = prisma) {
    return await tx.jobPublicShare.findUnique({
      where: { jobId },
    });
  },

  async getSharesByUserId(
    userId: string,
    tx: Prisma.TransactionClient = prisma,
  ) {
    return await tx.jobPublicShare.findMany({
      where: { userId },
    });
  },

  async createShare(
    jobId: string,
    userId: string,
    allowSearchIndexing: boolean,
    tx: Prisma.TransactionClient = prisma,
  ) {
    return await tx.jobPublicShare.create({
      data: { jobId, userId, allowSearchIndexing, token: uuidv4() },
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

  async deleteSharesByUserId(
    userId: string,
    tx: Prisma.TransactionClient = prisma,
  ) {
    return await tx.jobPublicShare.deleteMany({
      where: { userId },
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
    });
  },
};
