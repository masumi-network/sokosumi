"use server";
import { Tag } from "@prisma/client";

import prisma from "@/lib/db/prisma";

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
