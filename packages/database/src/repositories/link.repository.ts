import type { Prisma } from "../generated/prisma/client.js";
import { flattenLinkJobId, linkInclude, LinkWithJobId } from "../types/link.js";

export const linkRepository = {
  async upsertLink(
    data: {
      userId: string;
      eventId: string;
      url: string;
      title?: string;
    },
    tx: Prisma.TransactionClient,
  ): Promise<LinkWithJobId> {
    const link = await tx.link.upsert({
      where: {
        eventId_url: { eventId: data.eventId, url: data.url },
        userId: data.userId,
      },
      update: {
        title: data.title,
      },
      create: {
        user: { connect: { id: data.userId } },
        event: { connect: { id: data.eventId } },
        url: data.url,
        title: data.title,
      },
      include: linkInclude,
    });
    return flattenLinkJobId(link);
  },

  async getLinksByEventId(
    eventId: string,
    tx: Prisma.TransactionClient,
  ): Promise<LinkWithJobId[]> {
    const links = await tx.link.findMany({
      where: { eventId },
      include: linkInclude,
    });
    return links.map(flattenLinkJobId);
  },

  async getLinksByUserId(
    userId: string,
    tx: Prisma.TransactionClient,
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
    tx: Prisma.TransactionClient,
  ): Promise<LinkWithJobId[]> {
    const links = await tx.link.findMany({
      where: { userId, event: { jobId } },
      include: linkInclude,
    });
    return links.map(flattenLinkJobId);
  },

  async getLinksByJobId(
    jobId: string,
    tx: Prisma.TransactionClient,
  ): Promise<LinkWithJobId[]> {
    const links = await tx.link.findMany({
      where: { event: { jobId } },
      include: linkInclude,
    });
    return links.map(flattenLinkJobId);
  },
};
