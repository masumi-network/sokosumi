import type { Prisma } from "@sokosumi/database";

export const blobWithJobIdInclude = {
  event: {
    select: {
      jobId: true,
    },
  },
} as const;

export type BlobWithJobIdRaw = Prisma.BlobGetPayload<{
  include: typeof blobWithJobIdInclude;
}>;

export type BlobWithJobId = Omit<BlobWithJobIdRaw, "event"> & {
  jobId: string;
};

export function flattenBlobJobId(blob: BlobWithJobIdRaw): BlobWithJobId {
  const { event, ...rest } = blob;
  return {
    ...rest,
    jobId: event.jobId,
  };
}
