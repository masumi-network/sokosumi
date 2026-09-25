import { type AuthFn, withAuthChallenges } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";

import {
  authorizeProjectAccess,
  authorizeSession,
  registerCreatedSession,
} from "../lib/core";
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

    // Every request is authorized against the caller's *current* access.
    //
    // A request that names a session is checked against that session's
    // binding. Creation names none — and that was the hole: `POST
    // /eve/v1/session` accepts an initial message, so a valid, unexpired token
    // could start a conversation, and a turn, after the person had been
    // removed from the project. It now costs the same lookup as everything
    // else.
    const eveSessionId = sessionIdFromUrl(request.url);
    const authorized = eveSessionId
      ? await authorizeSession(claims, eveSessionId)
      : await authorizeProjectAccess(claims);
    if (!authorized) return null;

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

const base = eveChannel({ auth: [studioToken] });

/**
 * Record every conversation this channel creates, before its id is returned.
 *
 * Ownership is established here, by the agent, using the principal the auth
 * policy just verified — not later, and not by the browser. The id eve mints
 * is not known to anyone else until this handler answers, so binding inside
 * the create request is what makes the binding mean "this caller created it".
 *
 * Failing to record it fails the creation. A conversation Core does not know
 * about cannot be streamed, resumed or listed, and leaving one behind is
 * exactly the unbound session that used to be claimable by whoever learned
 * its id.
 */
function recordOnCreate(handler: RouteHandler): RouteHandler {
  return async (request: Request, context: never) => {
    const header = request.headers.get("authorization") ?? "";
    const claims = header.startsWith("Bearer ")
      ? verifyGrant(header.slice(7))
      : null;
    if (!claims) return new Response(null, { status: 401 });

    const response = await handler(request, context);
    // Only the HTTP create route is wrapped; the union also covers WebSocket
    // upgrades, which carry no session id to record.
    if (!(response instanceof Response)) return response;
    if (response.status >= 300) return response;

    const body = (await response
      .clone()
      .json()
      .catch(() => null)) as {
      sessionId?: unknown;
    } | null;
    const sessionId =
      typeof body?.sessionId === "string" ? body.sessionId : null;
    if (!sessionId) return response;

    if (!(await registerCreatedSession(claims, sessionId))) {
      return Response.json(
        {
          ok: false,
          error: "The conversation could not be started. Try again.",
        },
        { status: 503 },
      );
    }
    return response;
  };
}

type RouteHandler = (
  request: Request,
  context: never,
) => Promise<Response | unknown>;

export default {
  ...base,
  routes: base.routes.map((route) =>
    route.path === "/eve/v1/session" && route.method === "POST"
      ? {
          ...route,
          handler: recordOnCreate(route.handler as RouteHandler),
        }
      : route,
  ),
};
