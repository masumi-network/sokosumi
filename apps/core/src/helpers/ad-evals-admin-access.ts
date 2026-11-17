import type { Prisma } from "@sokosumi/database";

import { type EnvConfig, getEnv } from "@/config/env";
import { forbidden } from "@/helpers/error";

interface AdEvalsAdminAccessClient {
  member: Pick<Prisma.TransactionClient["member"], "findFirst">;
}
type AdEvalsAdminEnvironment = Pick<
  EnvConfig,
  "AD_EVALS_ADMIN_ORGANIZATION_SLUG" | "AD_EVALS_ADMIN_ORGANIZATION_ID"
>;

export function getAdEvalsAdminOrganization(env: AdEvalsAdminEnvironment) {
  const slug = env.AD_EVALS_ADMIN_ORGANIZATION_SLUG;
  const id = env.AD_EVALS_ADMIN_ORGANIZATION_ID;
  if (!slug && !id) return null;

  return { ...(slug ? { slug } : {}), ...(id ? { id } : {}) };
}

export async function hasAdEvalsAdminAccess(
  userId: string,
  tx: AdEvalsAdminAccessClient,
  env: AdEvalsAdminEnvironment = getEnv(),
): Promise<boolean> {
  const organization = getAdEvalsAdminOrganization(env);
  if (!organization) return false;

  const member = await tx.member.findFirst({
    where: { userId, organization },
    select: { id: true },
  });

  return member != null;
}

export async function requireAdEvalsAdminAccess(
  userId: string,
  tx: AdEvalsAdminAccessClient,
  env: AdEvalsAdminEnvironment = getEnv(),
): Promise<void> {
  if (!(await hasAdEvalsAdminAccess(userId, tx, env))) {
    throw forbidden(
      "Ad evals admin access requires membership in the configured workspace",
    );
  }
}
