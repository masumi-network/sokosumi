import {
  type Prisma,
  type TaskScheduleQuarantineReason,
  type TaskStatus,
} from "@sokosumi/database";

import { removeTaskSchedulePlannedOccurrences } from "@/helpers/task-schedule-occurrence-index";

interface TaskScheduleQuarantineClient {
  taskScheduleQuarantine: Pick<
    Prisma.TransactionClient["taskScheduleQuarantine"],
    "upsert"
  >;
  taskScheduleOccurrence: Pick<
    Prisma.TransactionClient["taskScheduleOccurrence"],
    "deleteMany"
  >;
}

export async function quarantineTaskSchedule(
  tx: TaskScheduleQuarantineClient,
  task: {
    id: string;
    metadata: string | null;
    nextRunAt: Date | null;
    status: TaskStatus;
  },
  reason: TaskScheduleQuarantineReason,
  details: string,
): Promise<void> {
  const snapshot = {
    reason,
    details,
    capturedMetadata: task.metadata,
    capturedNextRunAt: task.nextRunAt,
    capturedStatus: task.status,
  };

  await tx.taskScheduleQuarantine.upsert({
    where: { taskId: task.id },
    create: {
      taskId: task.id,
      ...snapshot,
    },
    update: snapshot,
  });
  await removeTaskSchedulePlannedOccurrences(tx, task.id);
}
