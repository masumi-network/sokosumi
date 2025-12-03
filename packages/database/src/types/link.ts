import type { Prisma } from "../generated/prisma/client.js";

export const linkInclude = {
  jobEvent: { include: { job: true } },
} as const;

export type LinkWithJob = Prisma.LinkGetPayload<{
  include: typeof linkInclude;
}>;
