import "server-only";

import { Prisma, Tag } from "@/prisma/generated/client";

import prisma from "./prisma";

/**
 * Repository for tag-related database operations.
 * Provides methods to retrieve tag records using Prisma.
 */
export const tagRepository = {
  /**
   * Retrieves all tags that are associated with at least one agent or agent override.
   * Tags are returned in ascending order by name.
   *
   * @param tx - (Optional) The Prisma transaction client to use. Defaults to the main Prisma client.
   * @returns A promise that resolves to an array of Tag objects.
   */
  getTags: async (tx: Prisma.TransactionClient = prisma): Promise<Tag[]> => {
    const tags = await tx.tag.findMany({
      where: {
        OR: [{ agents: { some: {} } }, { agentsOverride: { some: {} } }],
      },
      orderBy: {
        name: "asc",
      },
    });
    return tags;
  },
};
