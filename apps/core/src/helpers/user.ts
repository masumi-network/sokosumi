import type { Prisma } from "@sokosumi/database";
import { creditBucketRepository } from "@sokosumi/database/repositories";
import { convertCentsToCredits } from "@sokosumi/utils";

import prisma from "@/lib/db/prisma";

export async function getCredits(
  userId: string,
  organizationId: string | null,
  tx: Prisma.TransactionClient = prisma,
): Promise<number> {
  const cents = await creditBucketRepository.getBalance(
    userId,
    organizationId,
    tx,
  );
  return convertCentsToCredits(cents);
}
