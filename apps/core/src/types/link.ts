import type { Prisma } from "@sokosumi/database";

export const linkWithJobIdInclude = {
  event: {
    select: {
      jobId: true,
    },
  },
} as const;

export type LinkWithJobIdRaw = Prisma.LinkGetPayload<{
  include: typeof linkWithJobIdInclude;
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
