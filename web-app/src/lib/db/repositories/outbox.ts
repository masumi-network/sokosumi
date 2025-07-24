import "server-only";

import { prisma } from "@/lib/db/repositories";
import { Prisma } from "@/prisma/generated/client";

export async function createOutboxMutation(
  data: Prisma.OutboxCreateInput,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  await tx.outbox.create({ data });
}

export async function getNextLatestSequenceId(
  tx: Prisma.TransactionClient = prisma,
): Promise<number> {
  const latestSequenceId = await tx.outbox.aggregate({
    _max: { sequence_id: true },
  });
  return (latestSequenceId._max.sequence_id ?? 0) + 1;
}
