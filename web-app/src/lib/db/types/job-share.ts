import { Prisma } from "@/prisma/generated/client";

export const jobShareInclude = {
  creator: {
    select: {
      id: true,
      name: true,
      image: true,
    },
  },
  recipientOrganization: {
    select: {
      id: true,
      slug: true,
      name: true,
      logo: true,
    },
  },
} as const;

export type JobShareWithRelations = Prisma.JobShareGetPayload<{
  include: typeof jobShareInclude;
}>;
