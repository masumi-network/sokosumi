import type { Prisma } from "../generated/prisma/client.js";

export const blobInclude = {
  jobEvent: {
    select: {
      jobId: true,
    },
  },
} as const;

type BlobWithJobIdRaw = Prisma.BlobGetPayload<{
  include: typeof blobInclude;
}>;

// Flattened type
export type BlobWithJobId = Omit<BlobWithJobIdRaw, "jobEvent"> & {
  jobId: string;
};

// Mapper function to flatten the jobId
export function flattenBlobJobId(blob: BlobWithJobIdRaw): BlobWithJobId {
  const { jobEvent, ...rest } = blob;
  return {
    ...rest,
    jobId: jobEvent.jobId,
  };
}
