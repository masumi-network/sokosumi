import prisma from "../client.js";
import type { Prisma } from "../generated/prisma/client.js";
import { linkInclude, LinkWithJob } from "../types/link.js";

export const linkRepository = {
  async upsertLink(
    userId: string,
    jobEventId: string,
    url: string,
    title?: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<LinkWithJob> {
    const existing = await tx.link.findFirst({
      where: { jobEventId, url },
      include: linkInclude,
    });
    if (existing) return existing;
    return tx.link.create({
      data: {
        user: { connect: { id: userId } },
        jobEvent: { connect: { id: jobEventId } },
        url,
        title,
      },
      include: linkInclude,
    });
  },

  async getLinksByJobEventId(
    jobEventId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<LinkWithJob[]> {
    return tx.link.findMany({ where: { jobEventId }, include: linkInclude });
  },

  async getLinksByUserId(
    userId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<LinkWithJob[]> {
    return tx.link.findMany({ where: { userId }, include: linkInclude });
  },

  async getLinksByUserIdAndJobId(
    userId: string,
    jobId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<LinkWithJob[]> {
    return tx.link.findMany({
      where: { userId, jobEvent: { job: { id: jobId } } },
      include: linkInclude,
    });
  },

  async getLinksByJobId(
    jobId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<LinkWithJob[]> {
    return tx.link.findMany({
      where: { jobEvent: { jobId } },
      include: linkInclude,
    });
  },
};
