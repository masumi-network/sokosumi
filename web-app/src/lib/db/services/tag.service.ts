"use server";

import prisma from "@/lib/db/prisma";
import { Tag } from "@/prisma/generated/client";

export async function getTags(): Promise<Tag[]> {
  const tags = await prisma.tag.findMany({
    where: {
      OR: [{ agents: { some: {} } }, { agentsOverride: { some: {} } }],
    },
    orderBy: {
      name: "asc",
    },
  });
  return tags;
}
