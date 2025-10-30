import "server-only";

import prisma from "../client";
import type { Link, Prisma } from "../generated/prisma/client";

export const linkRepository = {
  async upsertLink(
    userId: string,
    jobId: string,
    url: string,
    title?: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Link> {
    const existing = await tx.link.findFirst({ where: { jobId, url } });
    if (existing) return existing;
    return tx.link.create({
      data: {
        user: { connect: { id: userId } },
        job: { connect: { id: jobId } },
        url,
        title,
      },
    });
  },
  async getLinksByJobId(
    jobId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Link[]> {
    return tx.link.findMany({ where: { jobId } });
  },
};
