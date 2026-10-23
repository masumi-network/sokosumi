import type { Prisma } from "@sokosumi/database";
import {
  isBetaOrganizationSlug,
  NEWSLETTER_BETA_ORGANIZATION_SLUG,
} from "@sokosumi/utils";

import { notFound } from "@/helpers/error";
import prisma from "@/lib/db/prisma";

/** Filters through the project's workspace, including for anonymous and batch reads. */
export const NEWSLETTER_BETA_PROJECT_WHERE = {
  workspace: { organization: { slug: NEWSLETTER_BETA_ORGANIZATION_SLUG } },
} satisfies Prisma.ProjectWhereInput;

export async function hasNewsletterBetaAccess(
  workspaceId: string,
  client: Pick<Prisma.TransactionClient, "workspace"> = prisma,
): Promise<boolean> {
  const workspace = await client.workspace.findUnique({
    where: { id: workspaceId },
    select: { organization: { select: { slug: true } } },
  });
  return isBetaOrganizationSlug("newsletter", workspace?.organization?.slug);
}

export async function requireNewsletterBetaAccess(
  workspaceId: string,
): Promise<void> {
  if (!(await hasNewsletterBetaAccess(workspaceId))) {
    throw notFound("Newsletter not found");
  }
}
