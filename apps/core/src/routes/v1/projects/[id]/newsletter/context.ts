import type { Context } from "hono";

import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { forbidden } from "@/helpers/error";
import type { EnvVariables } from "@/lib/hono";
import { isSharedSokoBotAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import type { NewsletterScope } from "@/services/newsletter.service";
import type { TaskDomainActor } from "@/services/task-domain.service";

export async function newsletterScope(
  c: Context<EnvVariables>,
  projectId: string,
): Promise<NewsletterScope> {
  await requireAuthorizedUserContext(c.var.authContext);
  const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
  return { projectId, workspaceId };
}

/** Shared Soko Bots may draft and submit issues within their own scope. */
export async function newsletterIssueScope(
  c: Context<EnvVariables>,
  projectId: string,
): Promise<NewsletterScope> {
  const auth = c.var.authContext;
  if (isSharedSokoBotAuthContext(auth)) {
    if (auth.scope === "project" && auth.projectId !== projectId) {
      throw forbidden("Newsletter is outside the Soko Bot's project");
    }
    return { projectId, workspaceId: auth.workspaceId };
  }
  return newsletterScope(c, projectId);
}

/** The approval Task retains the submitting actor without assigning work to an agent. */
export async function newsletterTaskContext(c: Context<EnvVariables>) {
  const auth = c.var.authContext;
  let actor: TaskDomainActor;
  if (auth.actor === "sokoBot") {
    actor = { kind: "soko_bot", sokoBotId: auth.sokoBotId };
    return {
      actor,
      ownerId: auth.userId,
      organizationId: auth.organizationId,
      humanUserId: null,
    };
  }
  const user = await requireAuthorizedUserContext(auth);
  actor =
    auth.actor === "coworker"
      ? {
          kind: "coworker",
          coworkerId: auth.coworkerId,
          vendorId: auth.vendorId,
          // Scope was authorized already; this is the workflow's review Task.
          enforceWorkspaceGrant: false,
        }
      : { kind: "user", userId: user.userId };
  return {
    actor,
    ownerId: user.userId,
    organizationId: user.organizationId,
    humanUserId:
      auth.actor === "user" && auth.authenticationMethod === "session"
        ? auth.userId
        : null,
  };
}
