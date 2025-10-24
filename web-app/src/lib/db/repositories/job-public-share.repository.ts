/**
 * Repository for managing JobShare entities and related queries.
 * Provides methods for creating, retrieving, and updating JobShare records.
 */

import { v4 as uuidv4 } from "uuid";

import { Prisma } from "@/prisma/generated/client";

import prisma from "./prisma";

export const jobShareRepository = {
  async getJobShareById(id: string, tx: Prisma.TransactionClient = prisma) {
    return await tx.jobPublicShare.findUnique({
      where: { id },
    });
  },

  async getJobShareByToken(
    token: string,
    tx: Prisma.TransactionClient = prisma,
  ) {
    return await tx.jobPublicShare.findUnique({
      where: {
        token,
      },
    });
  },

  async getJobShareByJobId(
    jobId: string,
    tx: Prisma.TransactionClient = prisma,
  ) {
    return await tx.jobPublicShare.findUnique({
      where: { jobId },
    });
  },

  async getJobPublicSharesByUserId(
    userId: string,
    tx: Prisma.TransactionClient = prisma,
  ) {
    return await tx.jobPublicShare.findMany({
      where: { userId },
    });
  },

  async createJobPublicShare(
    jobId: string,
    userId: string,
    allowSearchIndexing: boolean,
    tx: Prisma.TransactionClient = prisma,
  ) {
    return await tx.jobPublicShare.create({
      data: { jobId, userId, allowSearchIndexing, token: uuidv4() },
    });
  },

  async deleteJobPublicShareById(
    id: string,
    tx: Prisma.TransactionClient = prisma,
  ) {
    return await tx.jobPublicShare.delete({
      where: { id },
    });
  },

  async deleteJobPublicSharesByJobId(
    jobId: string,
    tx: Prisma.TransactionClient = prisma,
  ) {
    return await tx.jobPublicShare.deleteMany({
      where: { jobId },
    });
  },

  async deleteJobPublicSharesByUserId(
    userId: string,
    tx: Prisma.TransactionClient = prisma,
  ) {
    return await tx.jobPublicShare.deleteMany({
      where: { userId },
    });
  },

  async setJobPublicShareAllowSearchIndexingById(
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
