import type { Prisma } from "../generated/prisma/client.js";

export const linkInclude = {
  jobEvent: {
    select: {
      jobId: true,
    },
  },
} as const;

export type LinkWithJobIdRaw = Prisma.LinkGetPayload<{
  include: typeof linkInclude;
}>;

export type LinkWithJobId = Omit<LinkWithJobIdRaw, "jobEvent"> & {
  jobId: string;
};

export function flattenLinkJobId(link: LinkWithJobIdRaw): LinkWithJobId {
  const { jobEvent, ...rest } = link;
  return {
    ...rest,
    jobId: jobEvent.jobId,
  };
}
