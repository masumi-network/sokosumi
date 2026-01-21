import type { Prisma } from "@sokosumi/database";

export const taskInclude = {
  orchestrator: {
    select: {
      id: true,
      slug: true,
      name: true,
      url: true,
      email: true,
      description: true,
      image: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  attachments: true,
  _count: {
    select: {
      comments: true,
    },
  },
} as const;

export type Task = Prisma.TaskGetPayload<{
  include: typeof taskInclude;
}>;
