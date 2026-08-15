import type { Prisma } from "@sokosumi/database";
import { TaskStatus } from "@sokosumi/database";

import { mapVendor } from "@/helpers/vendor";
import { coworkerSchema } from "@/schemas/coworker.schema";

type CoworkerWithVendor = Prisma.CoworkerGetPayload<{
  include: typeof coworkerInclude;
}>;

export const coworkerInclude = {
  vendor: true,
  _count: {
    select: {
      assignedTasks: {
        where: {
          archivedAt: null,
          status: TaskStatus.COMPLETED,
        },
      },
    },
  },
} as const satisfies Prisma.CoworkerInclude;

export function mapCoworker(
  coworker: CoworkerWithVendor & {
    _count?: { assignedTasks?: number };
  },
) {
  return coworkerSchema.parse({
    ...coworker,
    completedTaskCount: coworker._count?.assignedTasks ?? 0,
    vendor: mapVendor(coworker.vendor),
  });
}
