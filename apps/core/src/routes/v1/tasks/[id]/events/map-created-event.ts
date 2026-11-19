import type { Prisma } from "@sokosumi/database";
import { internalServerError } from "@/helpers/error";
import { mapTaskEvent } from "@/helpers/task";
import { taskEventApiInclude } from "@/types/task";

export async function mapCreatedTaskEventForResponse(
  tx: Prisma.TransactionClient,
  eventId: string,
): Promise<ReturnType<typeof mapTaskEvent>> {
  const row = await tx.taskEvent.findUnique({
    where: { id: eventId },
    include: taskEventApiInclude,
  });
  if (!row) {
    throw internalServerError(`Task event not found after create: ${eventId}`);
  }
  return mapTaskEvent(row);
}
