import type { Prisma } from "@sokosumi/database";
import { SOCIAL_BETA_ORGANIZATION_SLUG } from "@sokosumi/utils";

import { getEnv } from "@/config/env";
import { notFound } from "@/helpers/error";
import prisma from "@/lib/db/prisma";

export const NEWSLETTER_BETA_SCOPE = {
  project: {
    workspace: { organization: { slug: SOCIAL_BETA_ORGANIZATION_SLUG } },
  },
} satisfies Prisma.NewsletterWhereInput;

export function isNewsletterEnabled(): boolean {
  return getEnv().NEWSLETTER_ENABLED;
}

export async function isNewsletterWorkspaceEnabled(
  workspaceId: string | null | undefined,
): Promise<boolean> {
  if (!isNewsletterEnabled() || !workspaceId) return false;
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { organization: { select: { slug: true } } },
  });
  return workspace?.organization?.slug === SOCIAL_BETA_ORGANIZATION_SLUG;
}

export function assertNewsletterEnabled(): void {
  if (!isNewsletterEnabled()) {
    throw notFound("Newsletter is not enabled");
  }
}
