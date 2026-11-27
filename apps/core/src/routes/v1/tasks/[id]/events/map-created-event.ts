import type { Prisma } from "@sokosumi/database";
import { internalServerError } from "@/helpers/error";
import { mapTaskEvent } from "@/helpers/task";
import { taskEventApiInclude } from "@/types/task";

const { transaction: _transaction, ...taskEventActorInclude } =
  taskEventApiInclude;

export async function mapCreatedTaskEventForResponse(
  tx: Prisma.TransactionClient,
  eventId: string,
  includeTransaction: boolean,
): Promise<ReturnType<typeof mapTaskEvent>> {
  const row = await tx.taskEvent.findUnique({
    where: { id: eventId },
    // A request without a charge only needs shared data for its response.
    include: includeTransaction ? taskEventApiInclude : taskEventActorInclude,
  });
  if (!row) {
    throw internalServerError(`Task event not found after create: ${eventId}`);
  }
  return mapTaskEvent(row);
}
