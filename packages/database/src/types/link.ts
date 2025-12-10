import type { Prisma } from "../generated/prisma/client.js";

export const linkInclude = {
  jobStatus: {
    select: {
      jobId: true,
    },
  },
} as const;

export type LinkWithJobIdRaw = Prisma.LinkGetPayload<{
  include: typeof linkInclude;
}>;

export type LinkWithJobId = Omit<LinkWithJobIdRaw, "jobStatus"> & {
  jobId: string;
};

export function flattenLinkJobId(link: LinkWithJobIdRaw): LinkWithJobId {
  const { jobStatus, ...rest } = link;
  return {
    ...rest,
    jobId: jobStatus.jobId,
  };
}
