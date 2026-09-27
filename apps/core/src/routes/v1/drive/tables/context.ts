import type { Context } from "hono";
import { resolveTableActor } from "@/helpers/data-table";
import { forbidden } from "@/helpers/error";
import type { EnvVariables } from "@/lib/hono";
import { requireWorkspaceContext } from "@/middleware/workspace";

export async function tableActor(c: Context<EnvVariables>) {
  const workspace = requireWorkspaceContext(c.var.workspaceContext);
  const actor = await resolveTableActor(
    c.var.authContext,
    workspace.workspaceId,
  );
  const taskId = c.req.header("X-Table-Task-Id");
  if (taskId && taskId.length > 200) throw forbidden("Invalid task context");
  return { ...actor, taskId };
}
