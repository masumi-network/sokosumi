import type { Prisma } from "../generated/prisma/client.js";
import {
  flattenLinkJobId,
  type LinkWithJobId,
  linkInclude,
} from "../types/link.js";

export const linkRepository = {
  /**
   * Insert links for a job event, skipping ones already stored.
   * `skipDuplicates` skips a row that collides with any unique on the model,
   * not only `eventId_url`; today that unique and the primary key are the only
   * ones. One statement covers the batch, and Prisma splits a very large one
   * into chunks. The per-link upsert this replaced spent a nested write, and so
   * an implicit transaction, on every URL.
   */
  async createLinks(
    data: {
      eventId: string;
      url: string;
    }[],
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.link.createMany({
      data,
      skipDuplicates: true,
    });
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
            ownerId: userId,
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
