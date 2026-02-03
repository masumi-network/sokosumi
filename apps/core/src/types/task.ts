import type { Prisma } from "@sokosumi/database";

export const taskInclude = {
  events: {
    orderBy: {
      createdAt: "asc",
    },
  },
  jobs: {
    select: { id: true },
    orderBy: {
      createdAt: "asc",
    },
  },
} as const;

export type TaskWithIncludes = Prisma.TaskGetPayload<{
  include: typeof taskInclude;
}>;
