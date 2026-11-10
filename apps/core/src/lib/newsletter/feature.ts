import type { Prisma } from "@sokosumi/database";
import { NEWSLETTER_BETA_ORGANIZATION_SLUG } from "@sokosumi/utils";

import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";
import { isEvalWorkspace } from "@/lib/evals/eval-guard";

/** Public signup, sending and events share the same pilot scope. */
export function newsletterPilotScope() {
  const organization = { slug: NEWSLETTER_BETA_ORGANIZATION_SLUG };
  const workspaceIds = getEnv().NEWSLETTER_PILOT_WORKSPACE_IDS ?? [];
  return {
    project: {
      workspace: workspaceIds.length
        ? { OR: [{ organization }, { id: { in: workspaceIds } }] }
        : { organization },
    },
  } satisfies Prisma.NewsletterWhereInput;
}

/**
 * The beta organization and pilot workspaces. Eval lanes can also draft issues.
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
  if (!workspace) return false;
  return (
    workspace.organization?.slug === NEWSLETTER_BETA_ORGANIZATION_SLUG ||
    (getEnv().NEWSLETTER_PILOT_WORKSPACE_IDS ?? []).includes(workspaceId)
  );
}
