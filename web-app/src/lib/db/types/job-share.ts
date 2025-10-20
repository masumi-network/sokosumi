import { Prisma } from "@/prisma/generated/client";

export const jobShareInclude = {
  creator: {
    select: {
      id: true,
      name: true,
      image: true,
    },
  },
} as const;

export type JobShareWithRelations = Prisma.JobShareGetPayload<{
  include: typeof jobShareInclude;
}>;
