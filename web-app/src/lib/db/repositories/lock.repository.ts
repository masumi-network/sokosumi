import "server-only";

import { Lock, Prisma } from "@/prisma/generated/client";

import prisma from "./prisma";

export const lockRepository = {
  async createLockByKey(
    key: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Lock> {
    return await tx.lock.create({
      data: {
        key,
      },
    });
  },

  async getLockByKey(
    key: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Lock | null> {
    return await tx.lock.findUnique({ where: { key } });
  },

  async lockByKey(
    key: string,
    instanceId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Lock> {
    return await tx.lock.update({
      where: { key },
      data: { isLocked: true, lockedBy: instanceId, lockedAt: new Date() },
    });
  },

  async unlockByKey(
    key: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Lock> {
    return await tx.lock.update({
      where: {
        key,
      },
      data: {
        isLocked: false,
        lockedBy: null,
        lockedAt: null,
      },
    });
  },
};
