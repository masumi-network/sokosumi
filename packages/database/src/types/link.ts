import type { Prisma } from "../generated/prisma/client.js";

export const linkInclude = {
  event: {
    select: {
      jobId: true,
    },
  },
} as const;

export type LinkWithJobIdRaw = Prisma.LinkGetPayload<{
  include: typeof linkInclude;
}>;

export type LinkWithJobId = Omit<LinkWithJobIdRaw, "event"> & {
  jobId: string;
};

export function flattenLinkJobId(link: LinkWithJobIdRaw): LinkWithJobId {
  const { event, ...rest } = link;
  return {
    ...rest,
    jobId: event.jobId,
  };
}
