import { Prisma } from "@/prisma/generated/client";

export const jobShareInclude = {
  job: true,
  organization: true,
} as const;

export type JobShareWithRelations = Prisma.JobShareGetPayload<{
  include: typeof jobShareInclude;
}>;
