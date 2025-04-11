"use server";

import prisma from "@/lib/db/prisma";
import { Prisma, Tag } from "@/prisma/generated/client";

export async function getTags(
  tx: Prisma.TransactionClient = prisma,
): Promise<Tag[]> {
  const tags = await tx.tag.findMany({
    where: {
      OR: [{ agents: { some: {} } }, { agentsOverride: { some: {} } }],
    },
    orderBy: {
      name: "asc",
    },
  });
  return tags;
}
