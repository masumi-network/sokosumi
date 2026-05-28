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
