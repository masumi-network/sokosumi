import { Prisma } from "@/prisma/generated/client";

export const jobPublicShareInclude = {
  user: {
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

export type JobPublicShareWithRelations = Prisma.JobPublicShareGetPayload<{
  include: typeof jobPublicShareInclude;
}>;
