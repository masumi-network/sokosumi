import { type AuthFn, withAuthChallenges } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";

import { authorizeSession } from "../lib/core";
import { verifyGrant } from "../lib/grant";

/**
 * Who may reach this agent, and which conversation they may reach.
 *
 * A short-lived studio token, minted by Web only after it has confirmed the
 * signed-in user's access to the project. The token carries the project, so a
 * caller cannot point the agent at a different one — and the tools read the
 * project from here, never from a model argument.
 *
 * The token alone is not enough. It says who the caller is and which project
 * they are working in; it says nothing about the session id in the URL.
 * Verifying only the token let a token for project A open, replay, clear and
 * send to a known session belonging to project B. So every request that names
 * a session is also authorized against that session's live binding in Core,
 * which re-reads the caller's current project membership as part of answering.
 *
 * An unbound session is refused rather than claimed. The binding is created by
 * the signed-in user through Core before the conversation carries anything, so
 * a session whose id leaks — or one that predates this code — does not become
 * whoever contacts it first.
 *
 * `placeholderAuth()` and `localDev()` are both absent on purpose. This agent
 * is reachable from the browser and touches paid generation, so there is no
 * environment in which an unauthenticated caller should get through.
 */

/**
 * The session id this request acts on, or null when it acts on none.
 *
 * Read from the path rather than a router param because the policy runs before
 * routing. Every session route is `…/session/:id[/…]`, and the public mount
 * can be prefixed (`/eve/image-studio/v1/…`), so anchoring on the `session`
 * segment is what stays correct across mounts.
 */
export function sessionIdFromUrl(rawUrl: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(rawUrl, "http://agent.invalid").pathname;
  } catch {
    return null;
  }
  const segments = pathname.split("/").filter(Boolean);
  const index = segments.lastIndexOf("session");
  if (index === -1) return null;
  const candidate = segments[index + 1];
  return candidate && candidate.length > 0 ? candidate : null;
}

const studioToken: AuthFn<Request> = withAuthChallenges(
  async (request) => {
    const header = request.headers.get("authorization") ?? "";
    if (!header.startsWith("Bearer ")) return null;
    const claims = verifyGrant(header.slice(7));
    if (!claims) return null;

    // Creating a session names no session, so there is nothing yet to authorize
    // against; the agent binds it on `session.started`. Every other request
    // names one, and that one must belong to this project.
    const eveSessionId = sessionIdFromUrl(request.url);
    if (eveSessionId && !(await authorizeSession(claims, eveSessionId))) {
      return null;
    }

    return {
      authenticator: "sokosumi-studio-token",
      principalId: claims.userId,
      principalType: "user" as const,
      attributes: {
        // Server-established, and the only source the tools trust for scope.
        sokosumiUserId: claims.userId,
        sokosumiProjectId: claims.projectId,
      },
    };
  },
  [{ scheme: "Bearer" }],
);

export default eveChannel({
  auth: [studioToken],
});
