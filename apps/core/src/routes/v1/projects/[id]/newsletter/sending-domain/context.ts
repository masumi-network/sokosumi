import type { Context } from "hono";

import type { EnvVariables } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireScopedProject } from "@/services/project-social-connections.service";

import { newsletterScope } from "../context";

/** Any member, or an agent acting for one, may read this Project's sending domain. */
export async function sendingDomainReadScope(
  c: Context<EnvVariables>,
  projectId: string,
) {
  const scope = await newsletterScope(c, projectId);
  await requireScopedProject(scope);
  return scope;
}

/** Any human with Project access may change its domain; agents never may. */
export async function sendingDomainManageScope(
  c: Context<EnvVariables>,
  projectId: string,
) {
  requireUserAuthContext(c.var.authContext);
  return sendingDomainReadScope(c, projectId);
}
