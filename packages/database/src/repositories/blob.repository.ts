import { BlobStatus, type Prisma } from "../generated/prisma/client.js";

export const blobRepository = {
  /**
   * Insert PENDING result Blobs from source URLs extracted from markdown,
   * skipping ones already stored. `skipDuplicates` skips a row that collides
   * with any unique on the model, not only `eventId_sourceUrl`; today that
   * unique and the primary key are the only ones. One statement covers the
   * batch, and Prisma splits a very large one into chunks. The per-URL upsert
   * this replaced spent a nested write, and so an implicit transaction, on
   * every URL.
   */
  async createOutputBlobs(
    data: {
      eventId: string;
      sourceUrl: string;
      name?: string;
    }[],
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.blob.createMany({
      data: data.map((blob) => ({ ...blob, status: BlobStatus.PENDING })),
      skipDuplicates: true,
    });
  },
};
