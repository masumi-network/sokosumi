import { Tag } from "@prisma/client";
import { unstable_cache } from "next/cache";

import prisma from "../prisma";

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
    orderBy: {
      name: "asc",
    },
  });
  return tags;
}
