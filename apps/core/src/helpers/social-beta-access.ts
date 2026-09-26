import type { Prisma } from "@sokosumi/database";
import { SOCIAL_BETA_ORGANIZATION_SLUG } from "@sokosumi/utils";

import { forbidden } from "@/helpers/error";

type SocialBetaAccessClient = Pick<Prisma.TransactionClient, "member">;

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
