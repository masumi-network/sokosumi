import type { Context } from "hono";
import type { EnvVariables } from "@/lib/hono";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { resolveContactActor } from "@/services/contacts.service";
import {
  type FundraisingActor,
  requireFundraising,
} from "@/services/fundraising.service";

/** The caller's workspace, once its organization is one with Fundraising. */
export async function fundraisingActor(
  c: Context<EnvVariables>,
): Promise<FundraisingActor> {
  const workspace = requireWorkspaceContext(c.var.workspaceContext);
  const organizationId = requireFundraising(workspace.organizationId);
  const actor = await resolveContactActor(
    c.var.authContext,
    workspace.workspaceId,
  );
  return { ...actor, organizationId };
}
