import "server-only";

import { Prisma, Tag } from "@/prisma/generated/client";

import prisma from "./prisma";

export async function retrieveTags(
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
