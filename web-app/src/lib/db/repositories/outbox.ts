import "server-only";

import { prisma } from "@/lib/db/repositories";
import { Prisma } from "@/prisma/generated/client";

export async function createOutboxMutation(
  data: Prisma.OutboxCreateInput,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  await tx.outbox.create({ data });
}
