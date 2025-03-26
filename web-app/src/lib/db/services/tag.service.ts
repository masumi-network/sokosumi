import { Tag } from "@prisma/client";
import { unstable_cache } from "next/cache";

import prisma from "@/lib/db/prisma";

export const getCachedTags = unstable_cache(
  async (): Promise<Tag[]> => {
    return await getTags();
  },
  ["tags"],
  {
    revalidate: 3600,
    tags: ["tags"],
  },
);

export async function getTags(): Promise<Tag[]> {
  const tags = await prisma.tag.findMany({
    where: {
      OR: [{ Agents: { some: {} } }, { AgentsOverride: { some: {} } }],
    },
    orderBy: {
      name: "asc",
    },
  });
  return tags;
}
