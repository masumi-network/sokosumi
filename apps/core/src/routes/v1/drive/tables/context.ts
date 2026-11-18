import type { Context } from "hono";
import { resolveTableActor } from "@/helpers/data-table";
import { conflict, forbidden } from "@/helpers/error";
import type { EnvVariables } from "@/lib/hono";
import { requireWorkspaceContext } from "@/middleware/workspace";

/** `X-Table-Workspace` value of a personal workspace; an organization's is its id. */
const PERSONAL_TABLE_WORKSPACE = "personal";

export async function tableActor(c: Context<EnvVariables>) {
  const workspace = requireWorkspaceContext(c.var.workspaceContext);
  // A page that confirmed a write in one workspace names it: after a switch, the session's workspace differs and
  // nothing is written, so a delayed or retried request never lands in the new workspace.
  const expected = c.req.header("X-Table-Workspace");
  if (
    expected !== undefined &&
    expected !== (workspace.organizationId ?? PERSONAL_TABLE_WORKSPACE)
  )
    throw conflict("The active workspace changed");
  const actor = await resolveTableActor(
    c.var.authContext,
    workspace.workspaceId,
  );
  const taskId = c.req.header("X-Table-Task-Id");
  if (taskId && taskId.length > 200) throw forbidden("Invalid task context");
  return { ...actor, taskId };
}
