import type { Prisma } from "../generated/prisma/client.js";

export type ScheduleListItem = Prisma.JobScheduleGetPayload<{
  include: {
    agent: true;
    jobs: {
      orderBy: { createdAt: "desc" };
      take: 1;
      select: { createdAt: true };
    };
  };
}>;
