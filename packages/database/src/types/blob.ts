import type { Prisma } from "../generated/prisma/client.js";

export const blobInclude = {
  jobEvent: { include: { job: true } },
} as const;

export type BlobWithJob = Prisma.BlobGetPayload<{
  include: typeof blobInclude;
}>;
