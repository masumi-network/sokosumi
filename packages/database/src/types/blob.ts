import type { Prisma } from "../generated/prisma/client.js";

export const blobInclude = {
  jobStatus: {
    select: {
      jobId: true,
    },
  },
  jobInput: {
    select: {
      jobId: true,
    },
  },
} as const;

type BlobWithJobIdRaw = Prisma.BlobGetPayload<{
  include: typeof blobInclude;
}>;

// Flattened type
export type BlobWithJobId = Omit<BlobWithJobIdRaw, "jobStatus" | "jobInput"> & {
  jobId?: string;
};

// Mapper function to flatten the jobId
export function flattenBlobJobId(blob: BlobWithJobIdRaw): BlobWithJobId {
  const { jobStatus, jobInput, ...rest } = blob;
  return {
    ...rest,
    jobId: jobStatus?.jobId ?? jobInput?.jobId,
  };
}
