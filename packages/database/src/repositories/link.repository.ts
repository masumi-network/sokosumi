import type { Prisma } from "../generated/prisma/client.js";

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
};
