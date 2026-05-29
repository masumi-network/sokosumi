import type { Prisma } from "../generated/prisma/client.js";
import { getSortedUniqueUserIds } from "./organization-seats.js";

export async function fetchOrganizationMemberUserIds(
  organizationId: string,
  tx: Prisma.TransactionClient,
): Promise<string[]> {
  const members = await tx.member.findMany({
    where: {
      organizationId,
    },
    select: {
      userId: true,
    },
    orderBy: [{ userId: "asc" }],
  });

  return getSortedUniqueUserIds(members.map((member) => member.userId));
}
