import prisma from "../client.js";
import type { Link, Prisma } from "../generated/prisma/client.js";

export const linkRepository = {
  async upsertLink(
    userId: string,
    jobEventId: string,
    url: string,
    title?: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Link> {
    const existing = await tx.link.findFirst({
      where: { jobEventId, url },
    });
    if (existing) return existing;
    return tx.link.create({
      data: {
        user: { connect: { id: userId } },
        jobEvent: { connect: { id: jobEventId } },
        url,
        title,
      },
    });
  },
  async getLinksByJobEventId(
    jobEventId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Link[]> {
    return tx.link.findMany({ where: { jobEventId } });
  },
};
