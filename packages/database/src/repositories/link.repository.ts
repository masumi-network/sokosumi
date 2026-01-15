import type { Prisma } from "../generated/prisma/client.js";
import { flattenLinkJobId, linkInclude, LinkWithJobId } from "../types/link.js";

export const linkRepository = {
  async upsertLink(
    data: {
      eventId: string;
      url: string;
      title?: string;
    },
    tx: Prisma.TransactionClient,
  ): Promise<LinkWithJobId> {
    const link = await tx.link.upsert({
      where: {
        eventId_url: { eventId: data.eventId, url: data.url },
      },
      update: {
        title: data.title,
      },
      create: {
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

  /**
   * Get all Link records for a user
   * Queries through the relationship chain: Link -> JobEvent -> Job -> User
   */
  async getLinksByUserId(
    userId: string,
    tx: Prisma.TransactionClient,
  ): Promise<LinkWithJobId[]> {
    const links = await tx.link.findMany({
      where: {
        event: {
          job: {
            userId,
          },
        },
      },
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
