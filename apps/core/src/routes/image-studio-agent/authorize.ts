import { getEnv } from "@/config/env";
import { requireProjectAccessForUser } from "@/lib/image-studio/access";
import { verifyAgentGrant } from "@/lib/image-studio/agent-grant";

export interface AgentGrantContext {
  userId: string;
  projectId: string;
  workspaceId: string;
}

export async function authorizeAgentGrant(
  request: Request,
): Promise<AgentGrantContext | Response> {
  const secret = getEnv().IMAGE_STUDIO_AGENT_SECRET;
  if (!secret) {
    // No secret configured means the agent surface is off, not open.
    return Response.json(
      { ok: false, error: "not_configured" },
      { status: 503 },
    );
  }
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  // "agent": only the agent may spend a grant here. The token Web mints for
  // the browser carries a different audience, so a page cannot call this
  // surface directly and bypass the agent.
  const verified = verifyAgentGrant(token, secret, "agent");
  if (!verified.ok) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  // The grant says who; the database says whether they may. Still true even
  // when the grant is seconds old.
  const access = await requireProjectAccessForUser({
    projectId: verified.claims.projectId,
    userId: verified.claims.userId,
  });
  return {
    userId: access.userId,
    projectId: access.projectId,
    workspaceId: access.workspaceId,
  };
}
