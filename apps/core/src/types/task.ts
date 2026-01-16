import type { Prisma } from "@sokosumi/database";

export const taskWithDetailsInclude = {
  orchestrator: true,
  attachments: true,
  events: {
    orderBy: {
      createdAt: "asc",
    },
  },
  comments: {
    orderBy: {
      createdAt: "asc",
    },
    include: {
      attachments: true,
    },
  },
} as const;

export type TaskWithDetails = Prisma.TaskGetPayload<{
  include: typeof taskWithDetailsInclude;
}>;

export const taskBoardItemInclude = {
  orchestrator: true,
  events: {
    orderBy: {
      createdAt: "desc",
    },
    take: 1,
  },
  _count: {
    select: {
      comments: true,
    },
  },
} as const;

export type TaskBoardItem = Prisma.TaskGetPayload<{
  include: typeof taskBoardItemInclude;
}>;
