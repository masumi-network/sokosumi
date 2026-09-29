import { getEnv } from "@/config/env";
import { serviceUnavailable, unauthorized } from "@/helpers/error";
import { requireProjectAccessForUser } from "@/lib/image-studio/access";
import { verifyAgentGrant } from "@/lib/image-studio/agent-grant";

export interface AgentGrantContext {
  userId: string;
  projectId: string;
  workspaceId: string;
}

/** Why a grant did not get through, before anything is said about it. */
type GrantRefusal = "not_configured" | "unauthorized";

/**
 * Verify an agent grant and re-derive the caller's current access.
 *
 * Shared by both agent surfaces so there is one decision, phrased twice. The
 * unversioned surface answers the agent's own compact `{ok,error}` shape; the
 * versioned surface answers Core's documented error envelope. Neither invents
 * its own rule about who may call.
 */
async function resolveAgentGrant(
  request: Request,
): Promise<AgentGrantContext | GrantRefusal> {
  const secret = getEnv().IMAGE_STUDIO_AGENT_SECRET;
  // No secret configured means the agent surface is off, not open.
  if (!secret) return "not_configured";

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return "unauthorized";
  // "agent": only the agent may spend a grant here. The token Web mints for
  // the browser carries a different audience, so a page cannot call this
  // surface directly and bypass the agent.
  const verified = verifyAgentGrant(token, secret, "agent");
  if (!verified.ok) return "unauthorized";

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

/**
 * The unversioned agent surface's authorization.
 *
 * Answers with a `Response` in the compact shape that surface uses throughout,
 * which the agent's HTTP helper reads directly.
 */
export async function authorizeAgentGrant(
  request: Request,
): Promise<AgentGrantContext | Response> {
  const resolved = await resolveAgentGrant(request);
  if (resolved === "not_configured") {
    return Response.json(
      { ok: false, error: "not_configured" },
      { status: 503 },
    );
  }
  if (resolved === "unauthorized") {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return resolved;
}

/**
 * The versioned agent surface's authorization.
 *
 * Throws, so the router's error handler renders Core's documented
 * `{error,message,meta}` envelope — the one the route's OpenAPI responses
 * advertise. Returning a hand-rolled body here is what made the versioned
 * surface document one contract and serve another.
 */
export async function requireAgentGrant(
  request: Request,
): Promise<AgentGrantContext> {
  const resolved = await resolveAgentGrant(request);
  if (resolved === "not_configured") {
    throw serviceUnavailable("The image studio agent surface is not enabled.", {
      kind: "image_studio_agent_not_configured",
    });
  }
  if (resolved === "unauthorized") {
    throw unauthorized("A valid image studio agent grant is required.", {
      kind: "image_studio_agent_grant_invalid",
    });
  }
  return resolved;
}
