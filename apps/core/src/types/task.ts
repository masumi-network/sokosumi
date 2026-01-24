import type { Prisma } from "@sokosumi/database";

export const taskInclude = {
  _count: {
    select: {
      events: true,
    },
  },
  events: {
    orderBy: {
      createdAt: "asc",
    },
  },
} as const;

export type TaskWithIncludes = Prisma.TaskGetPayload<{
  include: typeof taskInclude;
}>;
