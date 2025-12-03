import prisma from "../client.js";
import type { Prisma } from "../generated/prisma/client.js";
import { flattenLinkJobId, linkInclude, LinkWithJobId } from "../types/link.js";

export const linkRepository = {
  async upsertLink(
    userId: string,
    jobEventId: string,
    url: string,
    title?: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<LinkWithJobId> {
    const existing = await tx.link.findFirst({
      where: { jobEventId, url },
      include: linkInclude,
    });
    if (existing) return flattenLinkJobId(existing);
    const link = await tx.link.create({
      data: {
        user: { connect: { id: userId } },
        jobEvent: { connect: { id: jobEventId } },
        url,
        title,
      },
      include: linkInclude,
    });
    return flattenLinkJobId(link);
  },

  async getLinksByJobEventId(
    jobEventId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<LinkWithJobId[]> {
    const links = await tx.link.findMany({
      where: { jobEventId },
      include: linkInclude,
    });
    return links.map(flattenLinkJobId);
  },

  async getLinksByUserId(
    userId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<LinkWithJobId[]> {
    const links = await tx.link.findMany({
      where: { userId },
      include: linkInclude,
    });
    return links.map(flattenLinkJobId);
  },

  async getLinksByUserIdAndJobId(
    userId: string,
    jobId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<LinkWithJobId[]> {
    const links = await tx.link.findMany({
      where: { userId, jobEvent: { job: { id: jobId } } },
      include: linkInclude,
    });
    return links.map(flattenLinkJobId);
  },

  async getLinksByJobId(
    jobId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<LinkWithJobId[]> {
    const links = await tx.link.findMany({
      where: { jobEvent: { jobId } },
      include: linkInclude,
    });
    return links.map(flattenLinkJobId);
  },
};
