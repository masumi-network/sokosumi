import type { Context } from "hono";

import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import type { EnvVariables } from "@/lib/hono";
import { requireWorkspaceContext } from "@/middleware/workspace";
import type { NewsletterScope } from "@/services/newsletter.service";

export async function newsletterScope(
  c: Context<EnvVariables>,
  projectId: string,
): Promise<NewsletterScope> {
  await requireAuthorizedUserContext(c.var.authContext);
  const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
  return { projectId, workspaceId };
}
