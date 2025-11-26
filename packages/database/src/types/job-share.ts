import type { Prisma } from "../generated/prisma/client.js";

export const jobShareInclude = {
  job: true,
  organization: true,
} as const;

export type JobShareWithRelations = Prisma.JobShareGetPayload<{
  include: typeof jobShareInclude;
}>;
