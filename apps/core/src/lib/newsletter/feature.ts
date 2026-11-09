import type { Prisma } from "@sokosumi/database";
import { NEWSLETTER_BETA_ORGANIZATION_SLUG } from "@sokosumi/utils";

import prisma from "@/lib/db/prisma";
import { isEvalWorkspace } from "@/lib/evals/eval-guard";

export const NEWSLETTER_BETA_SCOPE = {
  project: {
    workspace: { organization: { slug: NEWSLETTER_BETA_ORGANIZATION_SLUG } },
  },
} satisfies Prisma.NewsletterWhereInput;

/**
 * The beta organization, and the eval lanes so their bots can draft issues.
 * An issue goes out only once a person approves it, and nobody signs in to
 * an eval lane; adding subscribers is simulated there (`eval-guard.ts`).
 */
export async function isNewsletterWorkspaceEnabled(
  workspaceId: string | null | undefined,
): Promise<boolean> {
  if (!workspaceId) return false;
  if (await isEvalWorkspace(workspaceId)) return true;
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { organization: { select: { slug: true } } },
  });
  return workspace?.organization?.slug === NEWSLETTER_BETA_ORGANIZATION_SLUG;
}
