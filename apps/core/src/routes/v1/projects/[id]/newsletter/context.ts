import { SOCIAL_BETA_ORGANIZATION_SLUG } from "@sokosumi/utils";
import type { Context } from "hono";

import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { notFound } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import type { EnvVariables } from "@/lib/hono";
import { requireWorkspaceContext } from "@/middleware/workspace";
import type { NewsletterScope } from "@/services/newsletter.service";

export async function newsletterScope(
  c: Context<EnvVariables>,
  projectId: string,
): Promise<NewsletterScope> {
  await requireAuthorizedUserContext(c.var.authContext);
  const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { organization: { select: { slug: true } } },
  });
  if (workspace?.organization?.slug !== SOCIAL_BETA_ORGANIZATION_SLUG) {
    throw notFound("Newsletter is not enabled");
  }
  return { projectId, workspaceId };
}
