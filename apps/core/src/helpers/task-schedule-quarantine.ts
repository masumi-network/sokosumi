import {
  type Prisma,
  type TaskScheduleQuarantineReason,
  type TaskStatus,
} from "@sokosumi/database";

export async function quarantineTaskSchedule(
  tx: Prisma.TransactionClient,
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
}
