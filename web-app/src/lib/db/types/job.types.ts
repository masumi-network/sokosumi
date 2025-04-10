import { Prisma } from "@/prisma/generated/client";

export const jobInclude = {
  agent: true,
  user: true,
} as const;

export const jobOrderBy = {
  createdAt: "desc",
} as const;

export type JobWithRelations = Prisma.JobGetPayload<{
  include: typeof jobInclude;
}>;
