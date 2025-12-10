import prisma from "../client.js";
import type { Prisma } from "../generated/prisma/client.js";
import { flattenLinkJobId, linkInclude, LinkWithJobId } from "../types/link.js";

export const linkRepository = {
  async upsertLink(
    userId: string,
    jobStatusId: string,
    url: string,
    title?: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<LinkWithJobId> {
    const link = await tx.link.upsert({
      where: { jobStatusId_url: { jobStatusId, url }, userId },
      update: {
        title,
      },
      create: {
        user: { connect: { id: userId } },
        jobStatus: { connect: { id: jobStatusId } },
        url,
        title,
      },
      include: linkInclude,
    });
    return flattenLinkJobId(link);
  },

  async getLinksByJobStatusId(
    jobStatusId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<LinkWithJobId[]> {
    const links = await tx.link.findMany({
      where: { jobStatusId },
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
      where: { userId, jobStatus: { jobId } },
      include: linkInclude,
    });
    return links.map(flattenLinkJobId);
  },

  async getLinksByJobId(
    jobId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<LinkWithJobId[]> {
    const links = await tx.link.findMany({
      where: { jobStatus: { jobId } },
      include: linkInclude,
    });
    return links.map(flattenLinkJobId);
  },
};
