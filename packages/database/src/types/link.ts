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
  const jobId = event?.jobId;
  if (!jobId) {
    throw new Error(
      `Link ${rest.id} is missing job event (eventId=${rest.eventId})`,
    );
  }
  return {
    ...rest,
    jobId,
  };
}
