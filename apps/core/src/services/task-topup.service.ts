import { Channel, type Prisma } from "@sokosumi/database";
import { TaskStatus } from "@sokosumi/utils";

function isPrismaRecordNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2025"
  );
}

/**
 * Flip OUT_OF_CREDITS tasks to CREDITS_TOPPED_UP after a credit grant, scoped
 * to the organization when one is given, otherwise to the user. Tasks updated
 * concurrently (P2025) are skipped so the surrounding grant transaction is
 * never rolled back by a task race.
 */
export async function markOutOfCreditsTasksAsToppedUp(params: {
  organizationId: string | null;
  tx: Prisma.TransactionClient;
  userId: string;
}): Promise<void> {
  const tasks = await params.tx.task.findMany({
    where: {
      ...(params.organizationId
        ? { organizationId: params.organizationId }
        : { userId: params.userId }),
      status: TaskStatus.OUT_OF_CREDITS,
    },
    select: {
      id: true,
    },
  });

  for (const task of tasks) {
    try {
      await params.tx.task.update({
        where: {
          id: task.id,
          status: TaskStatus.OUT_OF_CREDITS,
        },
        data: {
          status: TaskStatus.CREDITS_TOPPED_UP,
          events: {
            create: {
              status: TaskStatus.CREDITS_TOPPED_UP,
              channel: Channel.SOKOSUMI,
              userId: params.userId,
              coworkerId: null,
            },
          },
        },
      });
    } catch (error) {
      if (isPrismaRecordNotFoundError(error)) {
        continue;
      }

      throw error;
    }
  }
}
