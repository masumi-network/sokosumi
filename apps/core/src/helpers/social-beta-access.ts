import type { Prisma } from "@sokosumi/database";
import { SOCIAL_BETA_ORGANIZATION_SLUG } from "@sokosumi/utils";

import { forbidden } from "@/helpers/error";

type SocialBetaAccessClient = Pick<Prisma.TransactionClient, "member">;

/** Filters a User relation to the beta workspace, for queries that cannot await a check. */
export const SOCIAL_BETA_USER_WHERE = {
  members: {
    some: { organization: { slug: SOCIAL_BETA_ORGANIZATION_SLUG } },
  },
} satisfies Prisma.UserWhereInput;

export async function hasSocialBetaAccess(
  userId: string,
  tx: SocialBetaAccessClient,
): Promise<boolean> {
  const member = await tx.member.findFirst({
    where: {
      userId,
      organization: { slug: SOCIAL_BETA_ORGANIZATION_SLUG },
    },
    select: { id: true },
  });

  return member != null;
}

export async function requireSocialBetaAccess(
  userId: string,
  tx: SocialBetaAccessClient,
): Promise<void> {
  if (!(await hasSocialBetaAccess(userId, tx))) {
    throw forbidden("Social is only available to utxo AG workspace members");
  }
}
