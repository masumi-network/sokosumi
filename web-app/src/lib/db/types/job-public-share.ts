import { Prisma } from "@/prisma/generated/client";

export const jobPublicShareInclude = {
  job: true,
} as const;

export type JobPublicShareWithRelations = Prisma.JobPublicShareGetPayload<{
  include: typeof jobPublicShareInclude;
}>;
