import type { Context } from "hono";

import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { notFound } from "@/helpers/error";
import type { EnvVariables } from "@/lib/hono";
import { isNewsletterWorkspaceEnabled } from "@/lib/newsletter/feature";
import { requireOwnerUserContext } from "@/middleware/auth";
import {
  requireWorkspaceContext,
  type WorkspaceContext,
} from "@/middleware/workspace";
import { assertCanManageNewsletterSendingDomain } from "@/services/newsletter-sending-domain.service";

async function enabledWorkspace(c: Context<EnvVariables>) {
  const workspace = requireWorkspaceContext(c.var.workspaceContext);
  if (!(await isNewsletterWorkspaceEnabled(workspace.workspaceId))) {
    throw notFound("Newsletter is not enabled");
  }
  return workspace;
}

/** Any member, or an agent acting for one, may read the sending domain. */
export async function sendingDomainReadWorkspace(
  c: Context<EnvVariables>,
): Promise<WorkspaceContext> {
  await requireAuthorizedUserContext(c.var.authContext);
  return enabledWorkspace(c);
}

/** Only a human workspace owner or admin may change it; agents never may. */
export async function sendingDomainManageWorkspace(
  c: Context<EnvVariables>,
): Promise<WorkspaceContext> {
  const user = requireOwnerUserContext(
    c.var.authContext,
    "Agents cannot manage the newsletter sending domain",
  );
  const workspace = await enabledWorkspace(c);
  await assertCanManageNewsletterSendingDomain(user.userId, workspace);
  return workspace;
}
