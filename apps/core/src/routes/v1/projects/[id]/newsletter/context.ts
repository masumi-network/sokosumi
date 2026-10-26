import type { Context } from "hono";

import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { notFound } from "@/helpers/error";
import type { EnvVariables } from "@/lib/hono";
import { isNewsletterWorkspaceEnabled } from "@/lib/newsletter/feature";
import { requireWorkspaceContext } from "@/middleware/workspace";
import type { NewsletterScope } from "@/services/newsletter.service";

export async function newsletterScope(
  c: Context<EnvVariables>,
  projectId: string,
): Promise<NewsletterScope> {
  await requireAuthorizedUserContext(c.var.authContext);
  const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
  if (!(await isNewsletterWorkspaceEnabled(workspaceId))) {
    throw notFound("Newsletter is not enabled");
  }
  return { projectId, workspaceId };
}
