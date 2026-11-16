import type { Prisma } from "@sokosumi/database";
import { creditBucketRepository } from "@sokosumi/database/repositories";
import { convertCentsToCredits } from "@sokosumi/utils";

import prisma from "@/lib/db/prisma";

export async function getCredits(
  userId: string | null,
  organizationId: string | null,
  tx: Prisma.TransactionClient = prisma,
  options?: { projectId?: string | null },
): Promise<number> {
  const cents = await creditBucketRepository.getBalance(
    userId,
    organizationId,
    tx,
    options,
  );
  return convertCentsToCredits(cents);
}
