import type { Prisma } from "@sokosumi/database";

export const taskInclude = {
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
