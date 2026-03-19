import type { Prisma } from "@sokosumi/database";

import prisma from "@/lib/db/prisma";

/**
 * Resolves a coworker by slug with chat capability and base URL.
 * Used when only slug is available (e.g. conversation metadata) for Responses API recovery.
 */
export async function findCoworkerWithChatBySlug(
  slug: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<{ id: string; slug: string; baseURL: string | null } | null> {
  return await tx.coworker.findFirst({
    where: {
      slug,
      archivedAt: null,
      isWhitelisted: true,
      capabilities: { has: "chat" },
      baseURL: { not: null },
    },
    select: {
      id: true,
      slug: true,
      baseURL: true,
    },
  });
}
